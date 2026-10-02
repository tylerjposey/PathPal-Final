import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { eq } from "drizzle-orm";
import {
  accountProfilesTable,
  db,
  familyGroupsTable,
  familyMembershipsTable,
} from "@workspace/db";

export const PATHPAL_DEMO_FAMILY_ID = "demo-family-ai4sg";
export const PATHPAL_DEMO_TEAM = "San Jose – West Clean Team";

export const PATHPAL_DEMO_ROLES = ["parent", "child", "manager", "worker"] as const;
export type PathPalDemoRole = (typeof PATHPAL_DEMO_ROLES)[number];

const demoUsers: Record<PathPalDemoRole, {
  userId: string;
  displayName: string;
  teamName: string | null;
}> = {
  parent: { userId: "demo-parent-ai4sg", displayName: "Taylor Morgan", teamName: null },
  child: { userId: "demo-child-ai4sg", displayName: "Maya Chen", teamName: null },
  manager: { userId: "demo-manager-ai4sg", displayName: "Avery Patel", teamName: null },
  worker: { userId: "demo-worker-ai4sg", displayName: "Luis Rivera", teamName: PATHPAL_DEMO_TEAM },
};

export type PathPalDemoClaims = {
  iss: "pathpal-demo";
  sub: string;
  role: PathPalDemoRole;
  familyId: string | null;
  teamName: string | null;
  exp: number;
};

function isDemoRole(value: unknown): value is PathPalDemoRole {
  return typeof value === "string" && PATHPAL_DEMO_ROLES.includes(value as PathPalDemoRole);
}

function familyCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(10), (byte) => alphabet[byte % alphabet.length]).join("");
}

function encodeBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function safeEqual(value: string, expected: string): boolean {
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function isPathPalDemoAuthEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

export function verifyPathPalDemoCredentials(input: {
  username: string;
  password: string;
  verificationCode: string;
}): boolean {
  return input.username.trim().toLowerCase() === "ai4sg" &&
    safeEqual(input.password, "1234") &&
    safeEqual(input.verificationCode.trim(), "1234");
}

export function getPathPalDemoUser(role: PathPalDemoRole) {
  return demoUsers[role];
}

export function createPathPalDemoToken(role: PathPalDemoRole, expiresAt: Date, secret: string): string {
  const user = demoUsers[role];
  const claims: PathPalDemoClaims = {
    iss: "pathpal-demo",
    sub: user.userId,
    role,
    familyId: role === "parent" || role === "child" ? PATHPAL_DEMO_FAMILY_ID : null,
    teamName: user.teamName,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const header = encodeBase64Url({ alg: "HS256", typ: "PPDEMO" });
  const payload = encodeBase64Url(claims);
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export function getPathPalDemoClaims(req: Request): PathPalDemoClaims | null {
  if (!isPathPalDemoAuthEnabled()) return null;
  const authorization = req.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;

  try {
    const headerValue = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as {
      alg?: unknown;
      typ?: unknown;
    };
    if (headerValue.alg !== "HS256" || headerValue.typ !== "PPDEMO") return null;

    const unsigned = `${header}.${payload}`;
    const expected = createHmac("sha256", secret).update(unsigned).digest("base64url");
    if (!safeEqual(signature, expected)) return null;

    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<PathPalDemoClaims>;
    if (claims.iss !== "pathpal-demo" || !isDemoRole(claims.role) ||
      !Number.isInteger(claims.exp) || (claims.exp ?? 0) <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    const user = demoUsers[claims.role];
    const expectedFamilyId = claims.role === "parent" || claims.role === "child" ? PATHPAL_DEMO_FAMILY_ID : null;
    if (claims.sub !== user.userId || claims.familyId !== expectedFamilyId || claims.teamName !== user.teamName) {
      return null;
    }
    return claims as PathPalDemoClaims;
  } catch {
    return null;
  }
}

export async function ensurePathPalDemoAccounts(): Promise<void> {
  if (!isPathPalDemoAuthEnabled()) throw new Error("Demo authentication is disabled.");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(accountProfilesTable).values(
      PATHPAL_DEMO_ROLES.map((role) => ({
        userId: demoUsers[role].userId,
        displayName: demoUsers[role].displayName,
        role,
        teamName: demoUsers[role].teamName,
      })),
    ).onConflictDoNothing();

    const [family] = await tx.select({ id: familyGroupsTable.id })
      .from(familyGroupsTable)
      .where(eq(familyGroupsTable.id, PATHPAL_DEMO_FAMILY_ID))
      .limit(1);
    if (!family) {
      await tx.insert(familyGroupsTable).values({
        id: PATHPAL_DEMO_FAMILY_ID,
        familyName: "The Chen family",
        parentUserId: demoUsers.parent.userId,
        invitationCode: familyCode(),
        createdAt: now,
        approvalDeadline: new Date("2100-01-01T00:00:00.000Z"),
      }).onConflictDoNothing();
    }

    await tx.insert(familyMembershipsTable).values([
      {
        familyId: PATHPAL_DEMO_FAMILY_ID,
        userId: demoUsers.parent.userId,
        role: "parent",
        status: "approved",
        requestedAt: now,
        approvedAt: now,
      },
      {
        familyId: PATHPAL_DEMO_FAMILY_ID,
        userId: demoUsers.child.userId,
        role: "child",
        status: "approved",
        requestedAt: now,
        approvedAt: now,
      },
    ]).onConflictDoUpdate({
      target: familyMembershipsTable.userId,
      set: {
        familyId: PATHPAL_DEMO_FAMILY_ID,
        status: "approved",
        approvedAt: now,
      },
    });
  });
}