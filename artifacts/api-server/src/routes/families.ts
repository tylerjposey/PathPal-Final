import { randomInt } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  CreateFamilyBody,
  CreateFamilyResponse,
  GetMyFamilyResponse,
  JoinFamilyBody,
  JoinFamilyResponse,
} from "@workspace/api-zod";
import {
  db,
  familyAccountsTable,
  familyChildrenTable,
  type FamilyAccountRow,
} from "@workspace/db";
import { authenticate, HttpError } from "../lib/report-session";

const router: IRouter = Router();

function requireParent(req: Parameters<typeof authenticate>[0]) {
  const claims = authenticate(req);
  if (claims.role !== "parent") throw new HttpError(403, "Only a parent can access these family settings.");
  return claims;
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error("Family request failed:", error);
  res.status(500).json({ error: "Family service is unavailable." });
}

async function familyResponse(family: FamilyAccountRow) {
  const children = await db
    .select()
    .from(familyChildrenTable)
    .where(eq(familyChildrenTable.familyId, family.id))
    .orderBy(asc(familyChildrenTable.createdAt));
  return {
    familyId: family.id,
    familyName: family.familyName,
    invitationCode: family.invitationCode,
    children: children.map(({ id, name, username }) => ({ id, name, username })),
  };
}

function createInvitationCode(): string {
  return randomInt(0, 10_000_000_000).toString().padStart(10, "0");
}

router.get("/families/me", async (req, res): Promise<void> => {
  try {
    const claims = requireParent(req);
    const [family] = await db
      .select()
      .from(familyAccountsTable)
      .where(eq(familyAccountsTable.ownerDemoSub, claims.sub))
      .limit(1);
    if (!family) throw new HttpError(404, "No family has been created for this demo parent.");
    res.json(GetMyFamilyResponse.parse(await familyResponse(family)));
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/families", async (req, res): Promise<void> => {
  const parsed = CreateFamilyBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.familyName.trim() || !parsed.data.childName.trim()) {
    res.status(400).json({ error: "Enter a family name and child name." });
    return;
  }

  try {
    const claims = requireParent(req);
    const family = await db.transaction(async (tx) => {
      let [current] = await tx
        .select()
        .from(familyAccountsTable)
        .where(eq(familyAccountsTable.ownerDemoSub, claims.sub))
        .limit(1);

      if (!current) {
        for (let attempt = 0; attempt < 8 && !current; attempt += 1) {
          [current] = await tx
            .insert(familyAccountsTable)
            .values({
              ownerDemoSub: claims.sub,
              familyName: parsed.data.familyName.trim(),
              invitationCode: createInvitationCode(),
            })
            .onConflictDoNothing()
            .returning();

          if (!current) {
            [current] = await tx
              .select()
              .from(familyAccountsTable)
              .where(eq(familyAccountsTable.ownerDemoSub, claims.sub))
              .limit(1);
          }
        }
      }

      if (!current) throw new HttpError(503, "A unique family code could not be generated.");

      const [updated] = await tx
        .update(familyAccountsTable)
        .set({ familyName: parsed.data.familyName.trim() })
        .where(eq(familyAccountsTable.id, current.id))
        .returning();
      current = updated ?? current;

      const [unregisteredChild] = await tx
        .select()
        .from(familyChildrenTable)
        .where(and(eq(familyChildrenTable.familyId, current.id), isNull(familyChildrenTable.username)))
        .orderBy(asc(familyChildrenTable.createdAt))
        .limit(1);

      if (unregisteredChild) {
        await tx
          .update(familyChildrenTable)
          .set({ name: parsed.data.childName.trim() })
          .where(eq(familyChildrenTable.id, unregisteredChild.id));
      } else {
        const [firstChild] = await tx
          .select({ id: familyChildrenTable.id })
          .from(familyChildrenTable)
          .where(eq(familyChildrenTable.familyId, current.id))
          .limit(1);
        if (!firstChild) {
          await tx.insert(familyChildrenTable).values({
            familyId: current.id,
            name: parsed.data.childName.trim(),
            username: null,
          });
        }
      }

      return current;
    });

    res.json(CreateFamilyResponse.parse(await familyResponse(family)));
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/families/join", async (req, res): Promise<void> => {
  const parsed = JoinFamilyBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.childName.trim() || !parsed.data.username.trim()) {
    res.status(400).json({ error: "Enter a valid family code, child name, and username." });
    return;
  }

  try {
    const invitationCode = parsed.data.invitationCode.trim();
    const childName = parsed.data.childName.trim();
    const username = parsed.data.username.trim().toLowerCase();
    const [family] = await db
      .select()
      .from(familyAccountsTable)
      .where(eq(familyAccountsTable.invitationCode, invitationCode))
      .limit(1);
    if (!family) throw new HttpError(404, "That family code was not found.");

    await db.transaction(async (tx) => {
      const [existingChild] = await tx
        .select()
        .from(familyChildrenTable)
        .where(and(
          eq(familyChildrenTable.familyId, family.id),
          eq(familyChildrenTable.username, username),
        ))
        .limit(1);

      if (existingChild) {
        if (existingChild.name.trim().toLowerCase() !== childName.toLowerCase()) {
          throw new HttpError(409, "That username is already used by another child in this family.");
        }
        return;
      }

      const [unregisteredChild] = await tx
        .select()
        .from(familyChildrenTable)
        .where(and(eq(familyChildrenTable.familyId, family.id), isNull(familyChildrenTable.username)))
        .orderBy(asc(familyChildrenTable.createdAt))
        .limit(1);

      if (unregisteredChild) {
        await tx
          .update(familyChildrenTable)
          .set({ name: childName, username })
          .where(eq(familyChildrenTable.id, unregisteredChild.id));
      } else {
        await tx.insert(familyChildrenTable).values({
          familyId: family.id,
          name: childName,
          username,
        });
      }
    });

    res.json(JoinFamilyResponse.parse(await familyResponse(family)));
  } catch (error) {
    handleError(error, res);
  }
});

export default router;