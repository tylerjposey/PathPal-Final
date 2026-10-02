import { createHash, randomBytes, randomUUID } from "node:crypto";
import { clerkClient, getAuth } from "@clerk/express";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  accountProfilesTable,
  db,
  familyGroupsTable,
  familyMembershipsTable,
  pathPalNotificationsTable,
  staffInvitationsTable,
} from "@workspace/db";
import {
  AcceptStaffInvitationBody,
  AcceptStaffInvitationResponse,
  ApproveFamilyJoinRequestResponse,
  CreateChildAccountBody,
  CreateChildAccountResponse,
  CreateParentAccountBody,
  CreateParentAccountResponse,
  CreateStaffInvitationBody,
  CreateStaffInvitationResponse,
  GetAccountStatusResponse,
  GetMyFamilyResponse,
  ListNotificationsResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
  RejectFamilyJoinRequestResponse,
} from "@workspace/api-zod";
import {
  authenticateAccount,
  HttpError,
  requireSignedInUserId,
  type PathPalPrincipal,
} from "../lib/pathpal-auth";

const router: IRouter = Router();
const FAMILY_APPROVAL_WINDOW_MS = 48 * 60 * 60 * 1000;
const STAFF_INVITATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FAMILY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function familyCode(): string {
  return Array.from(randomBytes(10), (byte) => FAMILY_CODE_ALPHABET[byte % FAMILY_CODE_ALPHABET.length]).join("");
}

function invitationCode(): string {
  return randomBytes(32).toString("base64url");
}

function codeHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function cleanName(value: string, maxLength: number): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > maxLength) {
    throw new HttpError(400, "Enter a valid name.");
  }
  return cleaned;
}

function sendError(res: Response, error: unknown, message: string): void {
  const status = error instanceof HttpError ? error.status : 500;
  res.status(status).json({
    error: error instanceof HttpError ? error.message : message,
  });
}

async function accountStatus(userId: string) {
  const [account] = await db.select().from(accountProfilesTable)
    .where(eq(accountProfilesTable.userId, userId)).limit(1);
  if (!account) {
    return GetAccountStatusResponse.parse({
      status: "needs_setup",
      userId,
      displayName: "",
      familyId: null,
      familyName: null,
      approvalDeadline: null,
      teamName: null,
    });
  }

  if (account.role === "parent") {
    const [family] = await db.select().from(familyGroupsTable)
      .where(eq(familyGroupsTable.parentUserId, userId)).limit(1);
    return GetAccountStatusResponse.parse({
      status: "parent",
      userId,
      displayName: account.displayName,
      familyId: family?.id ?? null,
      familyName: family?.familyName ?? null,
      approvalDeadline: family?.approvalDeadline ?? null,
      teamName: null,
    });
  }

  if (account.role === "child") {
    const [membership] = await db.select().from(familyMembershipsTable)
      .where(eq(familyMembershipsTable.userId, userId)).limit(1);
    const approved = membership?.status === "approved";
    const [family] = approved && membership
      ? await db.select().from(familyGroupsTable).where(eq(familyGroupsTable.id, membership.familyId)).limit(1)
      : [];
    return GetAccountStatusResponse.parse({
      status: membership?.status === "rejected" ? "child_rejected" : approved ? "child_approved" : "child_pending",
      userId,
      displayName: account.displayName,
      familyId: approved ? membership?.familyId ?? null : null,
      familyName: family?.familyName ?? null,
      approvalDeadline: null,
      teamName: null,
    });
  }

  return GetAccountStatusResponse.parse({
    status: account.role,
    userId,
    displayName: account.displayName,
    familyId: null,
    familyName: null,
    approvalDeadline: null,
    teamName: account.teamName,
  });
}

function familyMember(member: {
  id: number;
  displayName: string;
  role: string;
  status: string;
  requestedAt: Date;
  approvedAt: Date | null;
}) {
  return {
    membershipId: member.id,
    displayName: member.displayName,
    role: member.role,
    status: member.status,
    requestedAt: member.requestedAt,
    approvedAt: member.approvedAt,
  };
}

async function familyView(principal: PathPalPrincipal) {
  if (principal.role === "parent" && principal.familyId) {
    const [family] = await db.select().from(familyGroupsTable)
      .where(and(
        eq(familyGroupsTable.id, principal.familyId),
        eq(familyGroupsTable.parentUserId, principal.userId),
      )).limit(1);
    if (!family) throw new HttpError(403, "Family data is not available to this account.");

    const rows = await db.select({
      id: familyMembershipsTable.id,
      displayName: accountProfilesTable.displayName,
      role: familyMembershipsTable.role,
      status: familyMembershipsTable.status,
      requestedAt: familyMembershipsTable.requestedAt,
      approvedAt: familyMembershipsTable.approvedAt,
    }).from(familyMembershipsTable)
      .innerJoin(accountProfilesTable, eq(familyMembershipsTable.userId, accountProfilesTable.userId))
      .where(eq(familyMembershipsTable.familyId, family.id));
    return GetMyFamilyResponse.parse({
      state: "parent",
      familyName: family.familyName,
      invitationCode: family.invitationCode,
      approvalDeadline: family.approvalDeadline,
      members: rows.filter((member) => member.status === "approved").map(familyMember),
      pendingRequests: rows.filter((member) => member.role === "child" && member.status === "pending").map(familyMember),
    });
  }

  if (principal.role === "child") {
    if (principal.membershipStatus === "pending" || principal.membershipStatus === "rejected") {
      return GetMyFamilyResponse.parse({
        state: principal.membershipStatus === "rejected" ? "child_rejected" : "child_pending",
        familyName: null,
        invitationCode: null,
        approvalDeadline: null,
        members: [],
        pendingRequests: [],
      });
    }
    if (principal.membershipStatus === "approved" && principal.familyId) {
      const [family] = await db.select().from(familyGroupsTable)
        .where(eq(familyGroupsTable.id, principal.familyId)).limit(1);
      if (!family) throw new HttpError(403, "Family data is not available to this account.");
      const rows = await db.select({
        id: familyMembershipsTable.id,
        displayName: accountProfilesTable.displayName,
        role: familyMembershipsTable.role,
        status: familyMembershipsTable.status,
        requestedAt: familyMembershipsTable.requestedAt,
        approvedAt: familyMembershipsTable.approvedAt,
      }).from(familyMembershipsTable)
        .innerJoin(accountProfilesTable, eq(familyMembershipsTable.userId, accountProfilesTable.userId))
        .where(and(
          eq(familyMembershipsTable.familyId, family.id),
          eq(familyMembershipsTable.status, "approved"),
        ));
      return GetMyFamilyResponse.parse({
        state: "child_approved",
        familyName: family.familyName,
        invitationCode: null,
        approvalDeadline: null,
        members: rows.map(familyMember),
        pendingRequests: [],
      });
    }
  }

  throw new HttpError(403, "Family data is not available to this account.");
}

router.get("/accounts/me", async (req, res): Promise<void> => {
  try {
    res.json(await accountStatus(requireSignedInUserId(req)));
  } catch (error) {
    sendError(res, error, "Account status could not be loaded.");
  }
});

router.post("/accounts/bootstrap-manager", async (req, res): Promise<void> => {
  try {
    const userId = requireSignedInUserId(req);
    const designatedMaintainerId = process.env.PATHPAL_INITIAL_MANAGER_USER_ID;
    if (!designatedMaintainerId || userId !== designatedMaintainerId) {
      throw new HttpError(403, "This account is not configured to bootstrap the initial manager.");
    }
    const [existing] = await db.select().from(accountProfilesTable)
      .where(eq(accountProfilesTable.userId, userId)).limit(1);
    if (existing) {
      if (existing.role !== "manager") {
        throw new HttpError(409, "This account already has a different PathPal role.");
      }
      res.json(await accountStatus(userId));
      return;
    }
    const user = await clerkClient.users.getUser(userId);
    const displayName = cleanName(
      [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "City Case Manager",
      80,
    );
    await db.insert(accountProfilesTable).values({
      userId,
      displayName,
      role: "manager",
      createdAt: new Date(),
    });
    res.status(201).json(await accountStatus(userId));
  } catch (error) {
    sendError(res, error, "Initial manager account could not be created.");
  }
});

router.post("/accounts/parent", async (req, res): Promise<void> => {
  const parsed = CreateParentAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid parent and family name." });
    return;
  }
  try {
    const userId = requireSignedInUserId(req);
    const clerkUserId = getAuth(req).userId;
    if (!clerkUserId || clerkUserId !== userId) {
      throw new HttpError(401, "A verified email account is required to create a family.");
    }
    const displayName = cleanName(parsed.data.displayName, 80);
    const familyName = cleanName(parsed.data.familyName, 100);
    const now = new Date();
    const created = await db.transaction(async (tx) => {
      const [account] = await tx.insert(accountProfilesTable).values({
        userId,
        displayName,
        role: "parent",
        createdAt: now,
      }).onConflictDoNothing().returning();
      if (!account) throw new HttpError(409, "This account already has a PathPal profile.");
      const [family] = await tx.insert(familyGroupsTable).values({
        id: randomUUID(),
        familyName,
        parentUserId: userId,
        invitationCode: familyCode(),
        createdAt: now,
        approvalDeadline: new Date(now.getTime() + FAMILY_APPROVAL_WINDOW_MS),
      }).returning();
      if (!family) throw new Error("Family creation returned no row.");
      await tx.insert(familyMembershipsTable).values({
        familyId: family.id,
        userId,
        role: "parent",
        status: "approved",
        requestedAt: now,
        approvedAt: now,
      });
      return account;
    });
    res.status(201).json(CreateParentAccountResponse.parse({
      status: "parent",
      userId: created.userId,
      displayName: created.displayName,
      familyId: (await accountStatus(userId)).familyId,
      familyName,
      approvalDeadline: new Date(now.getTime() + FAMILY_APPROVAL_WINDOW_MS),
      teamName: null,
    }));
  } catch (error) {
    sendError(res, error, "Parent account could not be created.");
  }
});

router.post("/accounts/child", async (req, res): Promise<void> => {
  const parsed = CreateChildAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your name and a valid family invitation code." });
    return;
  }
  try {
    const userId = requireSignedInUserId(req);
    const clerkUserId = getAuth(req).userId;
    if (!clerkUserId || clerkUserId !== userId) {
      throw new HttpError(401, "A verified email account is required to join a family.");
    }
    const displayName = cleanName(parsed.data.displayName, 80);
    const normalizedCode = parsed.data.invitationCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,24}$/.test(normalizedCode)) {
      throw new HttpError(400, "Family invitation code is invalid.");
    }
    const phoneNumber = parsed.data.phoneNumber.trim();
    const phoneDigits = phoneNumber.replace(/\D/g, "");
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      throw new HttpError(400, "Enter a phone number with 7 to 15 digits.");
    }
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    await clerkClient.users.updateUserMetadata(clerkUserId, {
      privateMetadata: {
        ...clerkUser.privateMetadata,
        pathpalContactPhoneNumber: phoneNumber,
      },
    });
    const now = new Date();
    await db.transaction(async (tx) => {
      const [family] = await tx.select().from(familyGroupsTable)
        .where(eq(familyGroupsTable.invitationCode, normalizedCode)).limit(1);
      if (!family) throw new HttpError(400, "Family invitation code is invalid.");
      if (family.approvalDeadline <= now) {
        const [approvedChild] = await tx.select({ id: familyMembershipsTable.id })
          .from(familyMembershipsTable).where(and(
            eq(familyMembershipsTable.familyId, family.id),
            eq(familyMembershipsTable.role, "child"),
            eq(familyMembershipsTable.status, "approved"),
          )).limit(1);
        if (!approvedChild) {
          throw new HttpError(410, "This family's 48-hour approval window has passed.");
        }
      }

      const [existingAccount] = await tx.select().from(accountProfilesTable)
        .where(eq(accountProfilesTable.userId, userId)).limit(1);
      if (existingAccount && existingAccount.role !== "child") {
        throw new HttpError(409, "This account already has a different PathPal role.");
      }
      if (existingAccount) {
        const [existingMembership] = await tx.select().from(familyMembershipsTable)
          .where(eq(familyMembershipsTable.userId, userId)).limit(1);
        if (!existingMembership || existingMembership.status !== "rejected") {
          throw new HttpError(409, "This account already has an active family request.");
        }
        await tx.update(accountProfilesTable)
          .set({ displayName })
          .where(eq(accountProfilesTable.userId, userId));
        await tx.update(familyMembershipsTable).set({
          familyId: family.id,
          status: "pending",
          requestedAt: now,
          approvedAt: null,
        }).where(eq(familyMembershipsTable.id, existingMembership.id));
        const [updatedMembership] = await tx.select({ id: familyMembershipsTable.id })
          .from(familyMembershipsTable).where(eq(familyMembershipsTable.userId, userId)).limit(1);
        if (updatedMembership) {
          await tx.insert(pathPalNotificationsTable).values({
            userId: family.parentUserId,
            familyId: family.id,
            relatedMembershipId: updatedMembership.id,
            type: "child_join_request",
            title: "New family request",
            body: `${displayName} asked to join ${family.familyName}.`,
            createdAt: now,
          });
        }
        return;
      }

      await tx.insert(accountProfilesTable).values({
        userId,
        displayName,
        role: "child",
        createdAt: now,
      });
      const [membership] = await tx.insert(familyMembershipsTable).values({
        familyId: family.id,
        userId,
        role: "child",
        status: "pending",
        requestedAt: now,
      }).returning();
      if (!membership) throw new Error("Family request creation returned no row.");
      await tx.insert(pathPalNotificationsTable).values({
        userId: family.parentUserId,
        familyId: family.id,
        relatedMembershipId: membership.id,
        type: "child_join_request",
        title: "New family request",
        body: `${displayName} asked to join ${family.familyName}.`,
        createdAt: now,
      });
    });
    res.status(201).json(CreateChildAccountResponse.parse(await accountStatus(userId)));
  } catch (error) {
    sendError(res, error, "Family request could not be created.");
  }
});

router.post("/accounts/staff", async (req, res): Promise<void> => {
  const parsed = AcceptStaffInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your name and the staff invitation code." });
    return;
  }
  try {
    const userId = requireSignedInUserId(req);
    const displayName = cleanName(parsed.data.displayName, 80);
    const now = new Date();
    const invitation = await db.transaction(async (tx) => {
      const [found] = await tx.select().from(staffInvitationsTable)
        .where(eq(staffInvitationsTable.codeHash, codeHash(parsed.data.invitationCode.trim())))
        .limit(1);
      if (!found || found.acceptedAt || found.expiresAt <= now) {
        throw new HttpError(400, "Staff invitation is invalid or expired.");
      }
      if (found.role !== "manager" && found.role !== "worker") {
        throw new HttpError(400, "Staff invitation has an invalid role.");
      }
      const [account] = await tx.insert(accountProfilesTable).values({
        userId,
        displayName,
        role: found.role,
        teamName: found.role === "worker" ? found.teamName : null,
        createdAt: now,
      }).onConflictDoNothing().returning();
      if (!account) throw new HttpError(409, "This account already has a PathPal profile.");
      const [claimed] = await tx.update(staffInvitationsTable).set({
        acceptedBy: userId,
        acceptedAt: now,
      }).where(and(
        eq(staffInvitationsTable.id, found.id),
        isNull(staffInvitationsTable.acceptedAt),
        gt(staffInvitationsTable.expiresAt, now),
      )).returning();
      if (!claimed) throw new HttpError(400, "Staff invitation was already used or has expired.");
      return account;
    });
    res.status(201).json(AcceptStaffInvitationResponse.parse({
      status: invitation.role,
      userId: invitation.userId,
      displayName: invitation.displayName,
      familyId: null,
      familyName: null,
      approvalDeadline: null,
      teamName: invitation.teamName,
    }));
  } catch (error) {
    sendError(res, error, "Staff invitation could not be accepted.");
  }
});

router.get("/families/me", async (req, res): Promise<void> => {
  try {
    res.json(await familyView(await authenticateAccount(req)));
  } catch (error) {
    sendError(res, error, "Family information could not be loaded.");
  }
});

async function updateJoinRequest(
  req: Request,
  res: Response,
  status: "approved" | "rejected",
): Promise<void> {
  try {
    const principal = await authenticateAccount(req);
    if (principal.role !== "parent" || !principal.familyId) {
      throw new HttpError(403, "Only the owning parent can review family requests.");
    }
    const membershipId = Number(req.params.id);
    if (!Number.isInteger(membershipId) || membershipId < 1) {
      throw new HttpError(404, "Family request not found.");
    }
    const now = new Date();
    const [membership] = await db.transaction(async (tx) => {
      const [family] = await tx.select({
        approvalDeadline: familyGroupsTable.approvalDeadline,
      }).from(familyGroupsTable).where(and(
        eq(familyGroupsTable.id, principal.familyId!),
        eq(familyGroupsTable.parentUserId, principal.userId),
      )).limit(1);
      if (!family) throw new HttpError(403, "Family data is not available to this account.");
      if (family.approvalDeadline <= now) {
        const [approvedChild] = await tx.select({ id: familyMembershipsTable.id })
          .from(familyMembershipsTable).where(and(
            eq(familyMembershipsTable.familyId, principal.familyId!),
            eq(familyMembershipsTable.role, "child"),
            eq(familyMembershipsTable.status, "approved"),
          )).limit(1);
        if (!approvedChild) {
          throw new HttpError(410, "The 48-hour approval window has passed.");
        }
      }
      const [pending] = await tx.select({
        id: familyMembershipsTable.id,
        userId: familyMembershipsTable.userId,
        familyId: familyMembershipsTable.familyId,
      }).from(familyMembershipsTable).where(and(
        eq(familyMembershipsTable.id, membershipId),
        eq(familyMembershipsTable.familyId, principal.familyId!),
        eq(familyMembershipsTable.role, "child"),
        eq(familyMembershipsTable.status, "pending"),
      )).limit(1);
      if (!pending) throw new HttpError(404, "Family request not found.");
      const [updated] = await tx.update(familyMembershipsTable).set({
        status,
        approvedAt: status === "approved" ? now : null,
      }).where(and(
        eq(familyMembershipsTable.id, pending.id),
        eq(familyMembershipsTable.status, "pending"),
      )).returning({ id: familyMembershipsTable.id });
      if (!updated) throw new HttpError(404, "Family request not found.");
      await tx.update(pathPalNotificationsTable).set({ readAt: now })
        .where(and(
          eq(pathPalNotificationsTable.userId, principal.userId),
          eq(pathPalNotificationsTable.relatedMembershipId, pending.id),
          isNull(pathPalNotificationsTable.readAt),
        ));
      const [familyNameRow] = await tx.select({ familyName: familyGroupsTable.familyName })
        .from(familyGroupsTable).where(eq(familyGroupsTable.id, pending.familyId)).limit(1);
      await tx.insert(pathPalNotificationsTable).values({
        userId: pending.userId,
        familyId: pending.familyId,
        relatedMembershipId: pending.id,
        type: status === "approved" ? "child_approved" : "child_rejected",
        title: status === "approved" ? "You joined the family" : "Family request declined",
        body: status === "approved"
          ? `Your request to join ${familyNameRow?.familyName ?? "the family"} was approved.`
          : "Your request was declined. You can ask another family to invite you.",
        createdAt: now,
      });
      return [updated] as const;
    });
    res.json((status === "approved" ? ApproveFamilyJoinRequestResponse : RejectFamilyJoinRequestResponse).parse({
      membershipId: membership.id,
      status,
    }));
  } catch (error) {
    sendError(res, error, "Family request could not be updated.");
  }
}

router.post("/families/requests/:id/approve", (req, res): void => {
  void updateJoinRequest(req, res, "approved");
});

router.post("/families/requests/:id/reject", (req, res): void => {
  void updateJoinRequest(req, res, "rejected");
});

router.post("/staff/invitations", async (req, res): Promise<void> => {
  const parsed = CreateStaffInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid staff role and team." });
    return;
  }
  try {
    const principal = await authenticateAccount(req);
    if (principal.role !== "manager") {
      throw new HttpError(403, "Only a City Case Manager can invite staff.");
    }
    const role = parsed.data.role;
    const teamName = parsed.data.teamName ? cleanName(parsed.data.teamName, 120) : null;
    if (role === "worker" && !teamName) {
      throw new HttpError(400, "Choose the team for this City Worker.");
    }
    const code = invitationCode();
    const expiresAt = new Date(Date.now() + STAFF_INVITATION_WINDOW_MS);
    await db.insert(staffInvitationsTable).values({
      id: randomUUID(),
      codeHash: codeHash(code),
      role,
      teamName,
      createdBy: principal.userId,
      expiresAt,
    });
    res.status(201).json(CreateStaffInvitationResponse.parse({
      invitationCode: code,
      role,
      teamName,
      expiresAt,
    }));
  } catch (error) {
    sendError(res, error, "Staff invitation could not be created.");
  }
});

router.get("/notifications", async (req, res): Promise<void> => {
  try {
    const userId = requireSignedInUserId(req);
    const notifications = await db.select().from(pathPalNotificationsTable)
      .where(eq(pathPalNotificationsTable.userId, userId))
      .orderBy(desc(pathPalNotificationsTable.createdAt))
      .limit(100);
    res.json(ListNotificationsResponse.parse(notifications.map(({ id, type, title, body, createdAt, readAt }) => ({
      id, type, title, body, createdAt, readAt,
    }))));
  } catch (error) {
    sendError(res, error, "Notifications could not be loaded.");
  }
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  try {
    const userId = requireSignedInUserId(req);
    const params = MarkNotificationReadParams.safeParse(req.params);
    if (!params.success) throw new HttpError(404, "Notification not found.");
    const [notification] = await db.update(pathPalNotificationsTable).set({ readAt: new Date() })
      .where(and(
        eq(pathPalNotificationsTable.id, params.data.id),
        eq(pathPalNotificationsTable.userId, userId),
      )).returning();
    if (!notification) throw new HttpError(404, "Notification not found.");
    res.json(MarkNotificationReadResponse.parse({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
    }));
  } catch (error) {
    sendError(res, error, "Notification could not be updated.");
  }
});

export default router;