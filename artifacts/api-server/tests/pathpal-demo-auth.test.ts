import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { CreatePhoneReportSessionBody, CreateReportSessionBody } from "@workspace/api-zod";
import {
  createPathPalDemoToken,
  getPathPalDemoClaims,
  isPathPalDemoAuthEnabled,
  PATHPAL_DEMO_FAMILY_ID,
  PATHPAL_DEMO_ROLES,
  PATHPAL_DEMO_TEAM,
  verifyPathPalDemoCredentials,
  verifyPathPalDemoPhoneCode,
} from "../src/lib/pathpal-demo-auth";

const secret = "unit-test-demo-session-secret-with-more-than-32-characters";

function authorizationRequest(token: string): Request {
  return { get: () => `Bearer ${token}` } as unknown as Request;
}

test("demo login accepts only four roles and signed sessions only in development", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.SESSION_SECRET;

  try {
    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = secret;

    const credentials = { username: "AI4SG", password: "1234", verificationCode: "1234" };
    assert.equal(verifyPathPalDemoCredentials(credentials), true);
    assert.equal(verifyPathPalDemoCredentials({ ...credentials, password: "wrong" }), false);
    assert.equal(verifyPathPalDemoCredentials({ ...credentials, verificationCode: "0000" }), false);
    assert.equal(verifyPathPalDemoPhoneCode("4088877754", "1234"), true);
    assert.equal(verifyPathPalDemoPhoneCode("+1 (408) 887-7754", "1234"), true);
    assert.equal(verifyPathPalDemoPhoneCode("5551234567", "1234"), false);
    assert.equal(verifyPathPalDemoPhoneCode("4088877754", "0000"), false);

    for (const role of PATHPAL_DEMO_ROLES) {
      assert.equal(CreateReportSessionBody.safeParse({ ...credentials, role }).success, true);
      assert.equal(CreatePhoneReportSessionBody.safeParse({
        phoneNumber: "4088877754",
        role,
        verificationCode: "1234",
      }).success, true);
      const expiresAt = new Date(Date.now() + 60_000);
      const token = createPathPalDemoToken(role, expiresAt, secret);
      const claims = getPathPalDemoClaims(authorizationRequest(token));

      assert.equal(claims?.role, role);
      assert.equal(claims?.exp, Math.floor(expiresAt.getTime() / 1000));
      assert.equal(
        claims?.familyId,
        role === "parent" || role === "child" ? PATHPAL_DEMO_FAMILY_ID : null,
      );
      assert.equal(claims?.teamName, role === "worker" ? PATHPAL_DEMO_TEAM : null);
      assert.equal(isPathPalDemoAuthEnabled(), true);
    }

    assert.equal(
      CreateReportSessionBody.safeParse({ ...credentials, role: "citizen" }).success,
      false,
    );

    const validToken = createPathPalDemoToken("parent", new Date(Date.now() + 60_000), secret);
    const changedSignature = `${validToken.slice(0, -1)}${validToken.endsWith("x") ? "y" : "x"}`;
    assert.equal(getPathPalDemoClaims(authorizationRequest(changedSignature)), null);

    process.env.NODE_ENV = "production";
    assert.equal(isPathPalDemoAuthEnabled(), false);
    assert.equal(getPathPalDemoClaims(authorizationRequest(validToken)), null);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});