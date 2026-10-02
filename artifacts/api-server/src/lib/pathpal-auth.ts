import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import {
  accountProfilesTable,
  db,
  familyGroupsTable,
  familyMembershipsTable,
  type CommunityReportRow,
} from "@workspace/db";
import { getPathPalDemoClaims, type PathPalDemoRole } from "./pathpal-demo-auth";

export type PathPalRole = PathPalDemoRole;

export type PathPalPrincipal = {
  userId: string;
  displayName: string;
  role: PathPalRole;
  familyId: string | null;
  membershipStatus: string | null;
  teamName: string | null;
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function requireSignedInUserId(req: Request): string {
  const demoClaims = getPathPalDemoClaims(req);
  if (demoClaims) return demoClaims.sub;
  const userId = getAuth(req).userId;
  if (!userId) throw new HttpError(401, "A valid signed-in account is required.");
  return userId;
}

export async function authenticateAccount(req: Request): Promise<PathPalPrincipal> {
  const demoClaims = getPathPalDemoClaims(req);
  const userId = demoClaims?.sub ?? requireSignedInUserId(req);
  const [account] = await db.select().from(accountProfilesTable)
    .where(eq(accountProfilesTable.userId, userId)).limit(1);
  if (!account) throw new HttpError(409, "Complete account setup before using PathPal.");
  if (!["parent", "child", "manager", "worker"].includes(account.role)) {
    throw new HttpError(403, "This account has no active PathPal role.");
  }
  if (demoClaims && account.role !== demoClaims.role) {
    throw new HttpError(403, "The demonstration session role is no longer valid.");
  }

  let familyId: string | null = null;
  let membershipStatus: string | null = null;
  if (account.role === "parent") {
    const [family] = await db.select({ id: familyGroupsTable.id })
      .from(familyGroupsTable)
      .where(eq(familyGroupsTable.parentUserId, userId))
      .limit(1);
    if (!family) throw new HttpError(403, "The family account is not available.");
    familyId = family.id;
    membershipStatus = "approved";
  } else if (account.role === "child") {
    const [membership] = await db.select({
      familyId: familyMembershipsTable.familyId,
      status: familyMembershipsTable.status,
    }).from(familyMembershipsTable)
      .where(eq(familyMembershipsTable.userId, userId))
      .limit(1);
    if (!membership) throw new HttpError(403, "The family membership is not available.");
    familyId = membership.familyId;
    membershipStatus = membership.status;
  }

  return {
    userId,
    displayName: account.displayName,
    role: account.role as PathPalRole,
    familyId,
    membershipStatus,
    teamName: account.teamName,
  };
}

export function requireApprovedFamilyMember(principal: PathPalPrincipal): string {
  if (
    (principal.role !== "parent" && principal.role !== "child") ||
    !principal.familyId ||
    principal.membershipStatus !== "approved"
  ) {
    throw new HttpError(403, "Family access is available after the owning parent approves you.");
  }
  return principal.familyId;
}

export function canViewReport(principal: PathPalPrincipal, row: CommunityReportRow): boolean {
  if (principal.role === "manager") return true;
  if (principal.role === "worker") {
    return Boolean(principal.teamName) && row.assignedTeam === principal.teamName;
  }
  return principal.membershipStatus === "approved" &&
    principal.familyId !== null &&
    row.familyId === principal.familyId;
}

export function assertCanUpdateReport(
  principal: PathPalPrincipal,
  row: CommunityReportRow,
  fields: string[],
): void {
  if (principal.role !== "manager" && principal.role !== "worker") {
    throw new HttpError(403, "This role may not edit reports.");
  }
  if (principal.role === "worker") {
    if (fields.length === 0 || fields.some((field) => field !== "status")) {
      throw new HttpError(403, "Workers may update report status only.");
    }
    if (!principal.teamName || row.assignedTeam !== principal.teamName) {
      throw new HttpError(403, "Workers may update only reports assigned to their team.");
    }
  }
}