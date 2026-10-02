import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  HttpError,
  type PathPalPrincipal,
} from "../src/lib/pathpal-auth";
import {
  createFamilyJourneysRouter,
  type FamilyJourneyProgressUpdate,
  type FamilyJourneyRecord,
  type FamilyJourneySaveUpdate,
  type FamilyJourneyStore,
  type NewFamilyJourneyRecord,
} from "../src/routes/family-journeys";

const JOURNEY_PATH = "/families/me/journey";

function principal(
  role: PathPalPrincipal["role"],
  values: Partial<PathPalPrincipal> = {},
): PathPalPrincipal {
  return {
    userId: `${role}-user`,
    displayName: role,
    role,
    familyId: null,
    membershipStatus: null,
    teamName: null,
    ...values,
  };
}

function route(id: string) {
  return {
    id,
    name: `Route ${id}`,
    startStop: "Home",
    destinationStop: "School",
    durationMinutes: 12,
    walkingMeters: 350,
    transfers: 0,
    delayMinutes: 0,
    alerts: [],
    available: true,
    recommended: true,
    source: "live" as const,
    polyline: null,
    mode: "walking" as const,
    legs: [],
  };
}

function saveBody(routeId: string, claimedFamilyId?: string) {
  return {
    route: route(routeId),
    origin: {
      name: "Home",
      latitude: 37.3382,
      longitude: -121.8863,
    },
    destination: {
      name: "School",
      latitude: 37.3496,
      longitude: -121.939,
    },
    ...(claimedFamilyId ? { familyId: claimedFamilyId } : {}),
  };
}

class MemoryFamilyJourneyStore implements FamilyJourneyStore {
  private readonly journeys = new Map<string, FamilyJourneyRecord>();
  private sequence = 0;

  async findByFamilyId(familyId: string): Promise<FamilyJourneyRecord | undefined> {
    return this.journeys.get(familyId);
  }

  async saveForFamily(
    insertValues: NewFamilyJourneyRecord,
    updateValues: FamilyJourneySaveUpdate,
  ): Promise<FamilyJourneyRecord | undefined> {
    const existing = this.journeys.get(insertValues.familyId);
    const updated = existing
      ? { ...existing, ...updateValues }
      : {
          id: insertValues.id ?? `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`,
          familyId: insertValues.familyId,
          routeData: insertValues.routeData,
          originName: insertValues.originName,
          originLatitude: insertValues.originLatitude,
          originLongitude: insertValues.originLongitude,
          destinationName: insertValues.destinationName,
          destinationLatitude: insertValues.destinationLatitude,
          destinationLongitude: insertValues.destinationLongitude,
          milestoneIndex: insertValues.milestoneIndex ?? -1,
          tripUpdatedAt: insertValues.tripUpdatedAt ?? null,
          createdByUserId: insertValues.createdByUserId,
          updatedByUserId: insertValues.updatedByUserId,
          createdAt: insertValues.createdAt ?? new Date(),
          updatedAt: insertValues.updatedAt ?? new Date(),
        };

    this.journeys.set(insertValues.familyId, updated);
    return updated;
  }

  async advanceMilestone(
    journeyId: string,
    expectedMilestoneIndex: number,
    updateValues: FamilyJourneyProgressUpdate,
  ): Promise<FamilyJourneyRecord | undefined> {
    for (const [familyId, current] of this.journeys) {
      if (current.id !== journeyId) continue;
      if (current.milestoneIndex !== expectedMilestoneIndex) return undefined;
      const updated = { ...current, ...updateValues };
      this.journeys.set(familyId, updated);
      return updated;
    }
    return undefined;
  }
}

function createPrincipals(): Map<string, PathPalPrincipal> {
  return new Map([
    ["parent-a", principal("parent", { userId: "parent-a", familyId: "family-a", membershipStatus: "approved" })],
    ["child-a", principal("child", { userId: "child-a", familyId: "family-a", membershipStatus: "approved" })],
    ["parent-b", principal("parent", { userId: "parent-b", familyId: "family-b", membershipStatus: "approved" })],
    ["child-b", principal("child", { userId: "child-b", familyId: "family-b", membershipStatus: "approved" })],
    ["pending-child", principal("child", { userId: "pending-child", familyId: "family-a", membershipStatus: "pending" })],
    ["manager", principal("manager", { userId: "manager" })],
    ["worker", principal("worker", { userId: "worker", teamName: "West Clean Team" })],
  ]);
}

async function createApiHarness() {
  const principals = createPrincipals();
  const store = new MemoryFamilyJourneyStore();
  const app = express();
  app.use(express.json());
  app.use("/api", createFamilyJourneysRouter({
    store,
    authenticateAccount: async (req) => {
      const userId = req.header("x-test-user-id");
      const authenticatedPrincipal = userId ? principals.get(userId) : undefined;
      if (!authenticatedPrincipal) throw new HttpError(401, "A valid signed-in account is required.");
      return authenticatedPrincipal;
    },
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test API did not bind to a TCP port.");
  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/api`;

  return {
    store,
    async request(
      userId: string | null,
      path: string,
      options: { method?: string; body?: unknown } = {},
    ) {
      const headers: Record<string, string> = {};
      if (userId) headers["x-test-user-id"] = userId;
      if (options.body !== undefined) headers["content-type"] = "application/json";
      return fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

test("journey reads and saves stay scoped to the authenticated family", async () => {
  const api = await createApiHarness();
  try {
    const saveA = await api.request("parent-a", JOURNEY_PATH, {
      method: "PUT",
      body: saveBody("family-a-route", "family-b"),
    });
    const saveB = await api.request("parent-b", JOURNEY_PATH, {
      method: "PUT",
      body: saveBody("family-b-route", "family-a"),
    });
    assert.equal(saveA.status, 200);
    assert.equal(saveB.status, 200);

    const familyARead = await api.request("child-a", JOURNEY_PATH);
    const familyBRead = await api.request("child-b", JOURNEY_PATH);
    assert.equal(familyARead.status, 200);
    assert.equal(familyBRead.status, 200);
    assert.equal((await familyARead.json()).journey.route.id, "family-a-route");
    assert.equal((await familyBRead.json()).journey.route.id, "family-b-route");

    const familyBCheckIn = await api.request("child-b", `${JOURNEY_PATH}/check-ins`, {
      method: "POST",
      body: { milestoneIndex: 0 },
    });
    assert.equal(familyBCheckIn.status, 200);
    const familyAProgress = await api.request("parent-a", JOURNEY_PATH);
    assert.equal((await familyAProgress.json()).journey.milestoneIndex, -1);

    const replaceA = await api.request("parent-a", JOURNEY_PATH, {
      method: "PUT",
      body: saveBody("family-a-replacement", "family-b"),
    });
    assert.equal(replaceA.status, 200);
    assert.equal((await replaceA.json()).journey.route.id, "family-a-replacement");

    const familyAAfterReplace = await api.request("parent-a", JOURNEY_PATH);
    const familyBAfterReplace = await api.request("parent-b", JOURNEY_PATH);
    assert.equal((await familyAAfterReplace.json()).journey.route.id, "family-a-replacement");
    assert.equal((await familyBAfterReplace.json()).journey.route.id, "family-b-route");
  } finally {
    await api.close();
  }
});

test("pending children, managers, and workers cannot read or save journeys", async () => {
  const api = await createApiHarness();
  try {
    for (const userId of ["pending-child", "manager", "worker"]) {
      const read = await api.request(userId, JOURNEY_PATH);
      const save = await api.request(userId, JOURNEY_PATH, {
        method: "PUT",
        body: saveBody(`${userId}-attempt`),
      });
      const checkIn = await api.request(userId, `${JOURNEY_PATH}/check-ins`, {
        method: "POST",
        body: { milestoneIndex: 0 },
      });
      assert.equal(read.status, 403, `${userId} should not read family journeys`);
      assert.equal(save.status, 403, `${userId} should not save family journeys`);
      assert.equal(checkIn.status, 403, `${userId} should not check in to family journeys`);
    }

    const unauthenticated = await api.request(null, JOURNEY_PATH);
    assert.equal(unauthenticated.status, 401);
  } finally {
    await api.close();
  }
});

test("only the next valid child check-in advances journey progress", async () => {
  const api = await createApiHarness();
  try {
    const saved = await api.request("parent-a", JOURNEY_PATH, {
      method: "PUT",
      body: saveBody("check-in-route"),
    });
    assert.equal(saved.status, 200);

    const parentCheckIn = await api.request("parent-a", `${JOURNEY_PATH}/check-ins`, {
      method: "POST",
      body: { milestoneIndex: 0 },
    });
    assert.equal(parentCheckIn.status, 403);

    const skipped = await api.request("child-a", `${JOURNEY_PATH}/check-ins`, {
      method: "POST",
      body: { milestoneIndex: 1 },
    });
    assert.equal(skipped.status, 409);

    const first = await api.request("child-a", `${JOURNEY_PATH}/check-ins`, {
      method: "POST",
      body: { milestoneIndex: 0 },
    });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).journey.milestoneIndex, 0);

    const repeated = await api.request("child-a", `${JOURNEY_PATH}/check-ins`, {
      method: "POST",
      body: { milestoneIndex: 0 },
    });
    assert.equal(repeated.status, 409);

    const finalValid = await api.request("child-a", `${JOURNEY_PATH}/check-ins`, {
      method: "POST",
      body: { milestoneIndex: 1 },
    });
    assert.equal(finalValid.status, 200);
    assert.equal((await finalValid.json()).journey.milestoneIndex, 1);

    const outOfRange = await api.request("child-a", `${JOURNEY_PATH}/check-ins`, {
      method: "POST",
      body: { milestoneIndex: 2 },
    });
    assert.equal(outOfRange.status, 400);

    const finalRead = await api.request("parent-a", JOURNEY_PATH);
    assert.equal((await finalRead.json()).journey.milestoneIndex, 1);
  } finally {
    await api.close();
  }
});