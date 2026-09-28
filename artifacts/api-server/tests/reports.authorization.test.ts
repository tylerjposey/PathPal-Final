import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { Storage } from "@google-cloud/storage";
import { eq, inArray } from "drizzle-orm";
import app from "../src/app";
import {
  communityReportStatusEventsTable,
  communityReportsTable,
  db,
  pool,
} from "@workspace/db";

const testReporterA = "authorization-test-reporter-a";
const testReporterB = "authorization-test-reporter-b";
const testManager = "authorization-test-manager";
const testWorker = "authorization-test-worker";
const westCleanTeam = "San Jose – West Clean Team";
const otherTeam = "Authorization Test Other Team";
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=";
const pngBytes = Buffer.from(pngBase64, "base64");

type TestRole = "citizen" | "manager" | "worker";

function signedToken(role: TestRole, sub: string, exp = Math.floor(Date.now() / 1000) + 3600): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET with at least 32 characters is required to run authorization tests.");
  }
  const payload = Buffer.from(JSON.stringify({ role, sub, familyId: null, exp })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

const reporterAToken = signedToken("citizen", testReporterA);
const reporterBToken = signedToken("citizen", testReporterB);
const managerToken = signedToken("manager", testManager);
const workerToken = signedToken("worker", testWorker);

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
const createdIds: string[] = [];
const createdPhotoIds = new Set<string>();

const photoStorage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function headers(token?: string): HeadersInit {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "content-type": "application/json",
  };
}

async function api(path: string, token?: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers(token), ...init.headers },
  });
}

async function createReport(token: string, label: string, includePhoto: boolean): Promise<string> {
  const spoofedBody = {
    description: `Authorization test ${label} report with a unique ownership marker.`,
    latitude: 37.3089,
    longitude: -121.8982,
    role: "manager",
    reporterAccountId: testReporterB,
    familyAccountId: "attacker-selected-family",
    assignedTeam: westCleanTeam,
    status: "Resolved",
    managerNotes: "must be ignored",
    ...(includePhoto ? { photoBase64: pngBase64, contentType: "image/png" } : {}),
  };
  const response = await api("/reports", token, {
    method: "POST",
    body: JSON.stringify(spoofedBody),
  });
  const payload = await response.json() as { id?: string; error?: string; reporterAccountId?: string; status?: string; assignedTeam?: string | null };
  assert.equal(response.status, 201, `Test report creation failed: ${payload.error ?? response.status}`);
  assert.ok(payload.id, "Created report must have an ID.");
  createdIds.push(payload.id);
  if (includePhoto) createdPhotoIds.add(payload.id);
  assert.equal(payload.reporterAccountId, token === reporterAToken ? testReporterA : testReporterB);
  assert.equal(payload.status, "Submitted", "Request input must not set a report status.");
  assert.equal(payload.assignedTeam, null, "Request input must not assign a staff team.");
  return payload.id;
}

before(async () => {
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || !process.env.PRIVATE_OBJECT_DIR) {
    throw new Error("Private object storage must be configured to run report photo authorization tests.");
  }
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine the test server address.");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  try {
    if (createdIds.length) {
      const rows = await db.select({
        id: communityReportsTable.id,
        photoObjectKey: communityReportsTable.photoObjectKey,
      }).from(communityReportsTable).where(inArray(communityReportsTable.id, createdIds));
      const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (bucket) {
        await Promise.all(rows.flatMap((row) => row.photoObjectKey
          ? [photoStorage.bucket(bucket).file(row.photoObjectKey).delete({ ignoreNotFound: true })]
          : []));
      }
      await db.delete(communityReportStatusEventsTable)
        .where(inArray(communityReportStatusEventsTable.reportId, createdIds));
      await db.delete(communityReportsTable)
        .where(inArray(communityReportsTable.id, createdIds));
    }
  } finally {
    if (server) {
      server.close();
      await once(server, "close");
    }
    await pool.end();
  }
});

test("reporters list, read, and download only their own reports and photos", async () => {
  const reportAId = await createReport(reporterAToken, "reporter-a", true);
  const reportBId = await createReport(reporterBToken, "reporter-b", true);

  const listAResponse = await api("/reports", reporterAToken);
  assert.equal(listAResponse.status, 200);
  const listA = await listAResponse.json() as Array<{ id: string }>;
  assert.ok(listA.some((row) => row.id === reportAId));
  assert.ok(!listA.some((row) => row.id === reportBId));

  const listBResponse = await api("/reports", reporterBToken);
  assert.equal(listBResponse.status, 200);
  const listB = await listBResponse.json() as Array<{ id: string }>;
  assert.ok(listB.some((row) => row.id === reportBId));
  assert.ok(!listB.some((row) => row.id === reportAId));

  assert.equal((await api(`/reports/${reportAId}`, reporterAToken)).status, 200);
  assert.equal((await api(`/reports/${reportAId}`, reporterBToken)).status, 403);
  assert.equal((await api(`/reports/${reportAId}/photo`, reporterBToken)).status, 403);

  const ownPhoto = await api(`/reports/${reportAId}/photo`, reporterAToken);
  assert.equal(ownPhoto.status, 200);
  assert.equal(ownPhoto.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await ownPhoto.arrayBuffer()), pngBytes);
});

test("development mode accepts more than five report submissions from one client", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    for (let index = 0; index < 6; index += 1) {
      await createReport(reporterAToken, `development-volume-${index}`, false);
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("report input cannot spoof the reporter, assign a team, set status, or edit the report", async () => {
  const [reportB] = await db.select({ id: communityReportsTable.id })
    .from(communityReportsTable)
    .where(eq(communityReportsTable.reporterAccountId, testReporterB))
    .limit(1);
  assert.ok(reportB?.id, "Reporter B fixture should exist.");
  const response = await api(`/reports/${reportB.id}`, reporterBToken, {
    method: "PATCH",
    body: JSON.stringify({
      role: "manager",
      status: "Resolved",
      assignedTeam: westCleanTeam,
      reporterAccountId: testReporterA,
    }),
  });
  assert.equal(response.status, 403);
});

test("workers can read and change status only for reports assigned to their configured team", async () => {
  const [rowA] = await db.select({ id: communityReportsTable.id })
    .from(communityReportsTable)
    .where(eq(communityReportsTable.reporterAccountId, testReporterA))
    .limit(1);
  const [rowB] = await db.select({ id: communityReportsTable.id })
    .from(communityReportsTable)
    .where(eq(communityReportsTable.reporterAccountId, testReporterB))
    .limit(1);
  assert.ok(rowA?.id && rowB?.id, "Both reporter fixtures should exist.");

  const assignA = await api(`/reports/${rowA.id}`, managerToken, {
    method: "PATCH",
    body: JSON.stringify({ assignedTeam: westCleanTeam, status: "Assigned" }),
  });
  assert.equal(assignA.status, 200);
  const assignB = await api(`/reports/${rowB.id}`, managerToken, {
    method: "PATCH",
    body: JSON.stringify({ assignedTeam: otherTeam, status: "Assigned" }),
  });
  assert.equal(assignB.status, 200);

  const workerListResponse = await api("/reports", workerToken);
  assert.equal(workerListResponse.status, 200);
  const workerList = await workerListResponse.json() as Array<{ id: string }>;
  assert.ok(workerList.some((row) => row.id === rowA.id));
  assert.ok(!workerList.some((row) => row.id === rowB.id));
  assert.equal((await api(`/reports/${rowA.id}`, workerToken)).status, 200);
  assert.equal((await api(`/reports/${rowB.id}`, workerToken)).status, 403);
  assert.equal((await api(`/reports/${rowA.id}/photo`, workerToken)).status, 200);
  assert.equal((await api(`/reports/${rowB.id}/photo`, workerToken)).status, 403);

  const allowedUpdate = await api(`/reports/${rowA.id}`, workerToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "Under Review" }),
  });
  assert.equal(allowedUpdate.status, 200);
  const deniedUpdate = await api(`/reports/${rowB.id}`, workerToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "Resolved" }),
  });
  assert.equal(deniedUpdate.status, 403);
  const forbiddenField = await api(`/reports/${rowA.id}`, workerToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "Resolved", assignedTeam: otherTeam }),
  });
  assert.equal(forbiddenField.status, 403);
});

test("managers can access both reporters' reports and photos", async () => {
  const listResponse = await api("/reports", managerToken);
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json() as Array<{ id: string }>;
  for (const id of createdIds) assert.ok(listed.some((row) => row.id === id));
  for (const id of createdIds) {
    assert.equal((await api(`/reports/${id}`, managerToken)).status, 200);
  }
  for (const id of createdPhotoIds) {
    assert.equal((await api(`/reports/${id}/photo`, managerToken)).status, 200);
  }
});

test("unauthenticated, forged, and expired sessions cannot read or mutate reports", async () => {
  const reportId = createdIds[0];
  assert.ok(reportId, "A test report should exist.");
  const expiredToken = signedToken("manager", "authorization-test-expired", 1);
  const forgedToken = `${managerToken.slice(0, -1)}${managerToken.endsWith("a") ? "b" : "a"}`;

  for (const token of [undefined, forgedToken, expiredToken]) {
    assert.equal((await api("/reports", token)).status, 401);
    assert.equal((await api(`/reports/${reportId}`, token)).status, 401);
    assert.equal((await api(`/reports/${reportId}/photo`, token)).status, 401);
    assert.equal((await api(`/reports/${reportId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ status: "Resolved" }),
    })).status, 401);
  }
});