import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export type Role = "parent" | "child" | "citizen" | "manager" | "worker";
export type Claims = { role: Role; sub: string; familyId: string | null; exp: number };

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function createToken(claims: Claims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function authenticate(req: Request): Claims {
  const auth = req.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(auth);
  const secret = process.env.SESSION_SECRET;
  if (!match || !secret) throw new HttpError(401, "A valid bearer session is required.");

  const [payload, signature, extra] = match[1].split(".");
  if (!payload || !signature || extra) throw new HttpError(401, "A valid bearer session is required.");

  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new HttpError(401, "A valid bearer session is required.");
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
    const roles: Role[] = ["parent", "child", "citizen", "manager", "worker"];
    if (!roles.includes(claims.role) || !claims.sub || claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error("invalid");
    }
    return claims;
  } catch {
    throw new HttpError(401, "A valid bearer session is required.");
  }
}