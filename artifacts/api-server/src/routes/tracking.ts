import {
  createCipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import {
  CreateTrackingJourneyBody,
  CreateTrackingJourneyResponse,
  GetTrackingProfileResponse,
  OptInToTrackingJourneyResponse,
  OptInToTrackingJourneyParams,
  RecordTrackingCheckinResponse,
  RecordTrackingCheckinBody,
  UpdateTrackingLocationResponse,
  UpdateTrackingLocationBody,
  UpdateTrackingSettingsBody,
} from "@workspace/api-zod";
import type {
  TrackingJourneyEvent,
  TrackingProfileResponse,
  TrackingRoute,
} from "@workspace/api-zod";
import {
  db,
  familyAccountsTable,
  familyChildrenTable,
  trackingChildrenTable,
  trackingFamiliesTable,
  trackingJourneyEventsTable,
  trackingJourneysTable,
  type TrackingJourneyRow,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { authenticate, HttpError, type Claims } from "../lib/report-session";
import {
  distanceBetween,
  matchRoutePosition,
  measureRoute,
  type Coordinate,
} from "../lib/tracking-geometry";

const router: IRouter = Router();
const MAX_JOURNEY_AGE_MS = 48 * 60 * 60 * 1000;
const STALE_AFTER_MS = 5 * 60 * 1000;
const ARRIVAL_EVENT_PREFIX = "arrival:";
const DEMO_PARENT_SUB = "demo-family-parent-ai4sg";
const DEMO_CHILD_SUB = "demo-family-child-ai4sg";

class TrackingError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "TrackingError";
  }
}

function fail(status: number, message: string): never {
  throw new TrackingError(status, message);
}

function handleError(error: unknown, req: Request, res: Response): void {
  if (error instanceof TrackingError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log?.error({ err: error }, "Live tracking request failed");
  res.status(500).json({ error: "Live journey sharing is unavailable." });
}

function requireTrackingClaims(req: Request, requiredRole?: "parent" | "child"): Claims {
  try {
    const claims = authenticate(req);
    if (claims.role !== "parent" && claims.role !== "child") {
      fail(403, "Live journey sharing is available to family accounts only.");
    }
    if (requiredRole && claims.role !== requiredRole) {
      fail(403, requiredRole === "parent"
        ? "Only the parent can change this family setting."
        : "Only the child can opt in to a live journey.");
    }
    return claims;
  } catch (error) {
    if (error instanceof HttpError) fail(error.status, error.message);
    throw error;
  }
}

function journeyIdFrom(req: Request): string {
  const parsed = OptInToTrackingJourneyParams.safeParse(req.params);
  if (!parsed.success) fail(400, "Journey ID is invalid.");
  return parsed.data.id;
}

function createInvitationCode(): string {
  return randomInt(0, 10_000_000_000).toString().padStart(10, "0");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function locationEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) fail(503, "Secure location storage is not configured.");
  return Buffer.from(hkdfSync("sha256", secret, "", "pathpal-live-location-v1", 32));
}

function encryptLocation(value: {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", locationEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function safeHashEquals(expectedHash: string, token: string): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function bearerToken(req: Request): string | null {
  const value = req.get("authorization");
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function routeMilestones(route: TrackingRoute) {
  const milestones: Array<{
    key: string;
    title: string;
    subtitle: string;
    isArrival: boolean;
  }> = [];

  if (route.mode === "walking") {
    return [
      { key: "walk-start", title: "Started walking", subtitle: route.startStop, isArrival: false },
      { key: "walk-end", title: "Reached destination", subtitle: route.destinationStop, isArrival: true },
    ];
  }

  route.legs.forEach((leg, index) => {
    const last = index === route.legs.length - 1;
    if (leg.type === "walk") {
      milestones.push({
        key: `leg-${index}-walk`,
        title: last ? "Reached destination" : "Walking to the next stop",
        subtitle: `${leg.boardingStop.name} to ${leg.alightingStop.name}`,
        isArrival: last,
      });
      return;
    }
    const label = leg.routeNumber ? `Route ${leg.routeNumber}` : leg.routeName ?? "the bus";
    milestones.push({
      key: `leg-${index}-board`,
      title: `Boarded ${label}`,
      subtitle: `At ${leg.boardingStop.name}`,
      isArrival: false,
    });
    milestones.push({
      key: `leg-${index}-alight`,
      title: `Got off ${label}`,
      subtitle: `At ${leg.alightingStop.name}`,
      isArrival: false,
    });
  });

  if (route.legs.at(-1)?.type === "bus") {
    milestones.push({
      key: "arrived",
      title: "Reached destination",
      subtitle: route.destinationStop,
      isArrival: true,
    });
  }
  return milestones;
}

async function getEvents(journeyId: string) {
  return db
    .select()
    .from(trackingJourneyEventsTable)
    .where(eq(trackingJourneyEventsTable.journeyId, journeyId))
    .orderBy(asc(trackingJourneyEventsTable.createdAt));
}

function eventResponse(event: typeof trackingJourneyEventsTable.$inferSelect) {
  return {
    id: event.id,
    checkpointKey: event.checkpointKey,
    title: event.title,
    subtitle: event.subtitle,
    source: event.source as TrackingJourneyEvent["source"],
    corrected: event.corrected,
    createdAt: event.createdAt,
  } satisfies TrackingJourneyEvent;
}

function displayedLocationHealth(row: TrackingJourneyRow, now: number) {
  if (row.status === "awaiting_child") return "not_started" as const;
  if (row.status !== "active") return "unavailable" as const;
  if (!row.lastLocationAt || row.locationHealth === "unavailable") {
    return "unavailable" as const;
  }
  if (now - row.lastLocationAt.getTime() > STALE_AFTER_MS) return "stale" as const;
  return row.locationHealth === "off_route" ? "off_route" as const : "on_route" as const;
}

async function journeyResponse(
  row: TrackingJourneyRow,
  childName: string,
  events?: Awaited<ReturnType<typeof getEvents>>,
) {
  const route = CreateTrackingJourneyBody.shape.route.parse(row.routeData);
  const routeMeters = measureRoute(route);
  const journey = {
    id: row.id,
    childId: row.childId,
    childName,
    route,
    status: row.status,
    progressMeters: Math.min(routeMeters, Math.max(0, row.progressMeters)),
    routeMeters,
    progressPercent: Math.max(
      0,
      Math.min(100, Math.round((row.progressMeters / routeMeters) * 100)),
    ),
    locationHealth: displayedLocationHealth(row, Date.now()),
    lastLocationAt: row.lastLocationAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    events: (events ?? await getEvents(row.id)).map(eventResponse),
  };
  return CreateTrackingJourneyResponse.parse({ journey });
}

async function expireJourneys(): Promise<void> {
  const now = new Date();
  await db
    .update(trackingJourneysTable)
    .set({
      status: "expired",
      endedAt: now,
      encryptedLatestLocation: null,
      locationTokenHash: null,
      locationHealth: "unavailable",
    })
    .where(and(
      inArray(trackingJourneysTable.status, ["active", "awaiting_child"]),
      lt(trackingJourneysTable.expiresAt, now),
    ));
}

async function sourceFamilyForClaims(claims: Claims) {
  const ownerDemoSub = claims.role === "parent" ? claims.sub : DEMO_PARENT_SUB;
  const [familyAccount] = await db
    .select()
    .from(familyAccountsTable)
    .where(eq(familyAccountsTable.ownerDemoSub, ownerDemoSub))
    .limit(1);
  if (!familyAccount) fail(404, "A parent must set up the family before live tracking can be used.");

  const sourceChildren = await db
    .select()
    .from(familyChildrenTable)
    .where(eq(familyChildrenTable.familyId, familyAccount.id))
    .orderBy(asc(familyChildrenTable.createdAt));
  if (!sourceChildren.length) fail(404, "Add a child to the family before enabling live tracking.");
  return { familyAccount, sourceChildren };
}

async function ensureTrackingFamily(familyName: string, ownerDemoSub: string) {
  let [family] = await db
    .select()
    .from(trackingFamiliesTable)
    .where(eq(trackingFamiliesTable.ownerUserId, ownerDemoSub))
    .limit(1);

  if (!family) {
    [family] = await db
      .insert(trackingFamiliesTable)
      .values({
        ownerUserId: ownerDemoSub,
        familyName,
        invitationCode: createInvitationCode(),
      })
      .onConflictDoNothing()
      .returning();
    if (!family) {
      [family] = await db
        .select()
        .from(trackingFamiliesTable)
        .where(eq(trackingFamiliesTable.ownerUserId, ownerDemoSub))
        .limit(1);
    }
  }
  if (!family) fail(503, "The family tracking setting could not be saved.");

  if (family.familyName !== familyName) {
    const [updated] = await db
      .update(trackingFamiliesTable)
      .set({ familyName })
      .where(eq(trackingFamiliesTable.id, family.id))
      .returning();
    family = updated ?? family;
  }
  return family;
}

async function ensureTrackingChildren(
  familyId: string,
  sourceChildren: Array<{ id: string; name: string }>,
) {
  const children = [];
  for (const [index, sourceChild] of sourceChildren.entries()) {
    // The existing prototype has one shared child role. Keep it attached to the
    // first family child; later family members remain visible to the parent.
    const userId = index === 0 ? DEMO_CHILD_SUB : `demo-family-child-${sourceChild.id}`;
    let [child] = await db
      .select()
      .from(trackingChildrenTable)
      .where(eq(trackingChildrenTable.userId, userId))
      .limit(1);

    if (child) {
      if (child.familyId !== familyId || child.displayName !== sourceChild.name) {
        const [updated] = await db
          .update(trackingChildrenTable)
          .set({ familyId, displayName: sourceChild.name })
          .where(eq(trackingChildrenTable.id, child.id))
          .returning();
        child = updated ?? child;
      }
    } else {
      [child] = await db
        .insert(trackingChildrenTable)
        .values({ familyId, userId, displayName: sourceChild.name })
        .onConflictDoNothing()
        .returning();
      if (!child) {
        [child] = await db
          .select()
          .from(trackingChildrenTable)
          .where(eq(trackingChildrenTable.userId, userId))
          .limit(1);
      }
    }
    if (!child) fail(503, "The family child could not be linked to live tracking.");
    children.push(child);
  }
  return children;
}

async function profileForClaims(claims: Claims) {
  await expireJourneys();
  const { familyAccount, sourceChildren } = await sourceFamilyForClaims(claims);
  const family = await ensureTrackingFamily(familyAccount.familyName, familyAccount.ownerDemoSub);
  const children = await ensureTrackingChildren(family.id, sourceChildren);

  if (claims.role === "parent") {
    const journeys = await db
      .select()
      .from(trackingJourneysTable)
      .where(eq(trackingJourneysTable.familyId, family.id))
      .orderBy(asc(trackingJourneysTable.createdAt));
    const summaries = await Promise.all(
      journeys.map((journey) => {
        const child = children.find(({ id }) => id === journey.childId);
        return journeyResponse(journey, child?.displayName ?? "Child");
      }),
    );
    return GetTrackingProfileResponse.parse({
      role: "parent",
      familyId: family.id,
      familyName: family.familyName,
      liveTrackingEnabled: family.liveTrackingEnabled,
      children: children.map(({ id, displayName }) => ({ id, name: displayName })),
      journeys: summaries.map(({ journey }) => journey),
    });
  }

  const child = children.find(({ userId }) => userId === claims.sub);
  if (!child) fail(403, "This child session is not linked to the family.");
  const journeys = await db
    .select()
    .from(trackingJourneysTable)
    .where(eq(trackingJourneysTable.childId, child.id))
    .orderBy(asc(trackingJourneysTable.createdAt));
  const summaries = await Promise.all(
    journeys.map((journey) => journeyResponse(journey, child.displayName)),
  );
  return GetTrackingProfileResponse.parse({
    role: "child",
    familyId: family.id,
    familyName: family.familyName,
    liveTrackingEnabled: family.liveTrackingEnabled,
    children: [{ id: child.id, name: child.displayName }],
    journeys: summaries.map(({ journey }) => journey),
  });
}

async function addEvent(
  journeyId: string,
  checkpointKey: string,
  title: string,
  subtitle: string,
  source: "automatic" | "manual" | "correction" | "system",
) {
  const [inserted] = await db
    .insert(trackingJourneyEventsTable)
    .values({ journeyId, checkpointKey, title, subtitle, source })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(trackingJourneyEventsTable)
    .where(and(
      eq(trackingJourneyEventsTable.journeyId, journeyId),
      eq(trackingJourneyEventsTable.checkpointKey, checkpointKey),
    ))
    .limit(1);
  if (!existing) fail(500, "The journey checkpoint could not be saved.");
  return existing;
}

async function getJourneyForUser(
  journeyId: string,
  claims: Claims,
  allowedRole: "parent" | "child" | "either",
) {
  const [journey] = await db
    .select()
    .from(trackingJourneysTable)
    .where(eq(trackingJourneysTable.id, journeyId))
    .limit(1);
  if (!journey) fail(404, "Journey was not found.");
  const [family] = await db
    .select()
    .from(trackingFamiliesTable)
    .where(eq(trackingFamiliesTable.id, journey.familyId))
    .limit(1);
  if (!family) fail(404, "Tracking family was not found.");
  const [child] = await db
    .select()
    .from(trackingChildrenTable)
    .where(eq(trackingChildrenTable.id, journey.childId))
    .limit(1);
  if (!child) fail(404, "Assigned child was not found.");

  const isParent = claims.role === "parent" && family.ownerUserId === claims.sub;
  const isChild = claims.role === "child" && child.userId === claims.sub;
  if (
    !isParent && !isChild ||
    (allowedRole === "parent" && !isParent) ||
    (allowedRole === "child" && !isChild)
  ) {
    fail(403, "This account is not allowed to access this journey.");
  }
  return { journey, family, child, role: isParent ? "parent" as const : "child" as const };
}

router.get("/tracking/me", async (req, res): Promise<void> => {
  try {
    res.json(await profileForClaims(requireTrackingClaims(req)));
  } catch (error) {
    handleError(error, req, res);
  }
});

router.patch("/tracking/settings", async (req, res): Promise<void> => {
  const parsed = UpdateTrackingSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose whether child live tracking is enabled." });
    return;
  }
  try {
    const claims = requireTrackingClaims(req, "parent");
    const profile = await profileForClaims(claims);
    await db
      .update(trackingFamiliesTable)
      .set({ liveTrackingEnabled: parsed.data.enabled })
      .where(eq(trackingFamiliesTable.id, profile.familyId));

    if (!parsed.data.enabled) {
      const activeJourneys = await db
        .select()
        .from(trackingJourneysTable)
        .where(and(
          eq(trackingJourneysTable.familyId, profile.familyId),
          inArray(trackingJourneysTable.status, ["active", "awaiting_child"]),
        ));
      await db
        .update(trackingJourneysTable)
        .set({
          status: "ended",
          endedAt: new Date(),
          encryptedLatestLocation: null,
          locationTokenHash: null,
          locationHealth: "unavailable",
        })
        .where(and(
          eq(trackingJourneysTable.familyId, profile.familyId),
          inArray(trackingJourneysTable.status, ["active", "awaiting_child"]),
        ));
      await Promise.all(activeJourneys.map((journey) =>
        addEvent(
          journey.id,
          `sharing-disabled:${journey.id}`,
          "Live tracking disabled",
          "The parent turned off live tracking for this family.",
          "system",
        ),
      ));
    }

    res.json(await profileForClaims(claims));
  } catch (error) {
    handleError(error, req, res);
  }
});

router.post("/tracking/journeys", async (req, res): Promise<void> => {
  const parsed = CreateTrackingJourneyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a child and a valid provider-routed journey." });
    return;
  }
  try {
    const claims = requireTrackingClaims(req, "child");
    const profile = await profileForClaims(claims);
    if (!profile.liveTrackingEnabled) {
      fail(403, "Ask your parent to enable live tracking in More.");
    }
    const childProfile = profile.children.find(({ id }) => id === parsed.data.childId);
    if (!childProfile) fail(403, "This journey does not belong to the signed-in child.");
    const [child] = await db
      .select()
      .from(trackingChildrenTable)
      .where(and(
        eq(trackingChildrenTable.id, childProfile.id),
        eq(trackingChildrenTable.familyId, profile.familyId),
      ))
      .limit(1);
    if (!child) fail(404, "The signed-in child is no longer in this family.");

    const [currentJourney] = await db
      .select({ id: trackingJourneysTable.id })
      .from(trackingJourneysTable)
      .where(and(
        eq(trackingJourneysTable.childId, child.id),
        inArray(trackingJourneysTable.status, ["active", "awaiting_child"]),
      ))
      .limit(1);
    if (currentJourney) fail(409, "End the current shared journey before starting another.");

    const route = CreateTrackingJourneyBody.shape.route.safeParse(parsed.data.route);
    if (!route.success || route.data.source !== "live") {
      fail(400, "Live sharing is available only for provider-supplied routes.");
    }
    let routeMeters: number;
    try {
      routeMeters = measureRoute(route.data);
    } catch {
      fail(400, "This route does not include usable provider geometry.");
    }
    if (
      !Number.isFinite(route.data.originLatitude) ||
      !Number.isFinite(route.data.originLongitude) ||
      !Number.isFinite(route.data.destinationLatitude) ||
      !Number.isFinite(route.data.destinationLongitude) ||
      routeMeters < 10
    ) {
      fail(400, "This provider route is missing valid coordinates or geometry.");
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() +
      Math.min(
        MAX_JOURNEY_AGE_MS,
        Math.max(90 * 60 * 1000, (route.data.durationMinutes + 60) * 60 * 1000),
      ),
    );
    const [journey] = await db
      .insert(trackingJourneysTable)
      .values({
        familyId: profile.familyId,
        childId: child.id,
        routeData: route.data,
        status: "awaiting_child",
        parentApprovedAt: now,
        expiresAt,
        arrivalAttempt: 1,
      })
      .returning();
    await addEvent(
      journey.id,
      "family-tracking-enabled",
      "Live tracking available",
      `Waiting for ${child.displayName} to confirm sharing for this journey.`,
      "system",
    );
    res.status(201).json(await journeyResponse(journey, child.displayName));
  } catch (error) {
    handleError(error, req, res);
  }
});

router.post("/tracking/journeys/:id/opt-in", async (req, res): Promise<void> => {
  try {
    const journeyId = journeyIdFrom(req);
    const claims = requireTrackingClaims(req, "child");
    const { journey, child, family } = await getJourneyForUser(journeyId, claims, "child");
    if (!family.liveTrackingEnabled) fail(403, "Live tracking was disabled by the parent.");
    if (journey.expiresAt.getTime() <= Date.now()) {
      await expireJourneys();
      fail(410, "This journey invitation has expired.");
    }
    if (journey.status !== "awaiting_child") {
      fail(409, "This journey is not waiting for child consent.");
    }

    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const [updated] = await db
      .update(trackingJourneysTable)
      .set({
        status: "active",
        childOptedInAt: now,
        locationTokenHash: hashToken(token),
        encryptedLatestLocation: null,
        lastLocationAt: null,
        locationHealth: "unavailable",
      })
      .where(eq(trackingJourneysTable.id, journey.id))
      .returning();
    await addEvent(
      journey.id,
      `sharing-enabled:${journey.arrivalAttempt}`,
      "Child opted in",
      `${child.displayName} agreed to share during this journey.`,
      "system",
    );
    res.json(OptInToTrackingJourneyResponse.parse({
      journeyId: updated.id,
      token,
      expiresAt: updated.expiresAt.toISOString(),
    }));
  } catch (error) {
    handleError(error, req, res);
  }
});

router.post("/tracking/journeys/:id/locations", async (req, res): Promise<void> => {
  try {
    const journeyId = journeyIdFrom(req);
    const parsed = UpdateTrackingLocationBody.safeParse(req.body);
    if (!parsed.success) fail(400, "Location update is invalid.");
    const token = bearerToken(req);
    if (!token) fail(401, "Location sharing session is missing.");

    const [journey] = await db
      .select()
      .from(trackingJourneysTable)
      .where(eq(trackingJourneysTable.id, journeyId))
      .limit(1);
    if (!journey || !journey.locationTokenHash || !safeHashEquals(journey.locationTokenHash, token)) {
      fail(401, "Location sharing session is invalid.");
    }
    if (journey.status !== "active" || journey.expiresAt.getTime() <= Date.now()) {
      await expireJourneys();
      fail(410, "Location sharing has ended.");
    }

    const capturedAt = parsed.data.capturedAt instanceof Date
      ? parsed.data.capturedAt
      : new Date(parsed.data.capturedAt);
    const now = new Date();
    if (
      !Number.isFinite(capturedAt.getTime()) ||
      capturedAt.getTime() > now.getTime() + 2 * 60_000 ||
      capturedAt.getTime() < now.getTime() - 10 * 60_000
    ) {
      fail(400, "Location update is too old or has an invalid timestamp.");
    }

    const route = CreateTrackingJourneyBody.shape.route.parse(journey.routeData);
    const point: Coordinate = {
      lat: parsed.data.latitude,
      lng: parsed.data.longitude,
    };
    const previousProgress = journey.progressMeters;
    let progressMeters = previousProgress;
    let routeMeters = measureRoute(route);
    let health: "on_route" | "off_route" | "unavailable" = "unavailable";
    let responseStatus: "active" | "arrived" | "off_route" = "active";
    let journeyStatus: "active" | "arrived" = "active";
    let encryptedLatestLocation: string | null = null;

    if (parsed.data.accuracy <= 150) {
      const match = matchRoutePosition(route, point);
      routeMeters = match.routeMeters;
      const onRoute = match.distanceFromRoute <= Math.max(70, parsed.data.accuracy * 2);
      if (onRoute) {
        health = "on_route";
        progressMeters = Math.max(previousProgress, match.progressMeters);
        encryptedLatestLocation = encryptLocation({
          latitude: point.lat,
          longitude: point.lng,
          accuracy: parsed.data.accuracy,
          capturedAt: capturedAt.toISOString(),
        });

        const thresholds = [
          { percent: 25, title: "Journey underway", subtitle: "About one quarter of the route is complete." },
          { percent: 50, title: "Halfway there", subtitle: "About half of the provider route is complete." },
          { percent: 75, title: "Approaching destination", subtitle: "Most of the provider route is complete." },
        ];
        for (const threshold of thresholds) {
          if (progressMeters >= routeMeters * threshold.percent / 100) {
            await addEvent(
              journey.id,
              `progress-${threshold.percent}`,
              threshold.title,
              threshold.subtitle,
              "automatic",
            );
          }
        }

        const remainingMeters = distanceBetween(point, {
          lat: route.destinationLatitude,
          lng: route.destinationLongitude,
        });
        const closeToEnd = progressMeters >= routeMeters - 100;
        if (parsed.data.accuracy <= 35 && closeToEnd && remainingMeters <= 80) {
          responseStatus = "arrived";
          journeyStatus = "arrived";
          progressMeters = routeMeters;
          health = "unavailable";
          encryptedLatestLocation = null;
          await addEvent(
            journey.id,
            `${ARRIVAL_EVENT_PREFIX}${journey.arrivalAttempt}`,
            "Arrival detected",
            "The device reached the provider route destination area. Check that this is correct.",
            "automatic",
          );
        }
      } else {
        health = "off_route";
        responseStatus = "off_route";
        encryptedLatestLocation = encryptLocation({
          latitude: point.lat,
          longitude: point.lng,
          accuracy: parsed.data.accuracy,
          capturedAt: capturedAt.toISOString(),
        });
      }
    }

    const [updated] = await db
      .update(trackingJourneysTable)
      .set({
        status: journeyStatus,
        progressMeters,
        locationHealth: health,
        lastLocationAt: now,
        encryptedLatestLocation,
        locationTokenHash: journeyStatus === "arrived" ? null : journey.locationTokenHash,
        endedAt: journeyStatus === "arrived" ? now : null,
      })
      .where(eq(trackingJourneysTable.id, journey.id))
      .returning();

    res.json(UpdateTrackingLocationResponse.parse({
      status: responseStatus,
      progressMeters,
      routeMeters,
      progressPercent: Math.max(0, Math.min(100, Math.round(progressMeters / routeMeters * 100))),
      locationHealth: health,
      events: (await getEvents(journey.id)).map(eventResponse),
    }));
    void updated;
  } catch (error) {
    handleError(error, req, res);
  }
});

router.post("/tracking/journeys/:id/check-ins", async (req, res): Promise<void> => {
  const parsed = RecordTrackingCheckinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid route checkpoint." });
    return;
  }
  try {
    const journeyId = journeyIdFrom(req);
    const claims = requireTrackingClaims(req, "child");
    const { journey, child } = await getJourneyForUser(journeyId, claims, "child");
    const route = CreateTrackingJourneyBody.shape.route.parse(journey.routeData);
    const milestone = routeMilestones(route).find(({ key }) => key === parsed.data.checkpointKey);
    if (!milestone) fail(400, "That checkpoint is not part of this provider route.");

    const checkpointKey = milestone.isArrival
      ? `${ARRIVAL_EVENT_PREFIX}${journey.arrivalAttempt}`
      : parsed.data.checkpointKey;
    const [existing] = await db
      .select()
      .from(trackingJourneyEventsTable)
      .where(and(
        eq(trackingJourneyEventsTable.journeyId, journey.id),
        eq(trackingJourneyEventsTable.checkpointKey, checkpointKey),
      ))
      .limit(1);
    if (existing) {
      res.json(RecordTrackingCheckinResponse.parse(eventResponse(existing)));
      return;
    }
    if (journey.status !== "active") fail(409, "This journey is not accepting check-ins.");

    const event = await addEvent(
      journey.id,
      checkpointKey,
      milestone.title,
      `${milestone.subtitle} — confirmed by ${child.displayName}.`,
      "manual",
    );
    if (milestone.isArrival) {
      await db
        .update(trackingJourneysTable)
        .set({
          status: "arrived",
          progressMeters: measureRoute(route),
          locationTokenHash: null,
          encryptedLatestLocation: null,
          locationHealth: "unavailable",
          endedAt: new Date(),
        })
        .where(eq(trackingJourneysTable.id, journey.id));
    }
    res.json(RecordTrackingCheckinResponse.parse(eventResponse(event)));
  } catch (error) {
    handleError(error, req, res);
  }
});

router.post("/tracking/journeys/:id/correct-arrival", async (req, res): Promise<void> => {
  try {
    const journeyId = journeyIdFrom(req);
    const claims = requireTrackingClaims(req, "child");
    const { journey, child } = await getJourneyForUser(journeyId, claims, "child");
    if (journey.status !== "arrived") fail(409, "This journey has no arrival to correct.");
    const arrivalKey = `${ARRIVAL_EVENT_PREFIX}${journey.arrivalAttempt}`;
    const [arrival] = await db
      .select()
      .from(trackingJourneyEventsTable)
      .where(and(
        eq(trackingJourneyEventsTable.journeyId, journey.id),
        eq(trackingJourneyEventsTable.checkpointKey, arrivalKey),
      ))
      .limit(1);
    if (!arrival || arrival.source !== "automatic" || arrival.corrected) {
      fail(409, "There is no automatic arrival to correct.");
    }
    await db
      .update(trackingJourneyEventsTable)
      .set({ corrected: true })
      .where(eq(trackingJourneyEventsTable.id, arrival.id));
    await addEvent(
      journey.id,
      `arrival-correction:${journey.arrivalAttempt}`,
      "Arrival corrected",
      `${child.displayName} reported that the destination has not been reached.`,
      "correction",
    );
    const [updated] = await db
      .update(trackingJourneysTable)
      .set({
        status: "awaiting_child",
        arrivalAttempt: journey.arrivalAttempt + 1,
        childOptedInAt: null,
        locationTokenHash: null,
        encryptedLatestLocation: null,
        locationHealth: "not_started",
        lastLocationAt: null,
        endedAt: null,
      })
      .where(eq(trackingJourneysTable.id, journey.id))
      .returning();
    res.json(await journeyResponse(updated, child.displayName));
  } catch (error) {
    handleError(error, req, res);
  }
});

router.post("/tracking/journeys/:id/end", async (req, res): Promise<void> => {
  try {
    const journeyId = journeyIdFrom(req);
    const claims = requireTrackingClaims(req);
    const { journey, child } = await getJourneyForUser(journeyId, claims, "either");
    if (journey.status !== "ended" && journey.status !== "expired") {
      await addEvent(
        journey.id,
        `sharing-ended:${journey.arrivalAttempt}`,
        "Sharing stopped",
        "Live location sharing ended. Saved checkpoint events remain available.",
        "system",
      );
    }
    const [updated] = await db
      .update(trackingJourneysTable)
      .set({
        status: "ended",
        endedAt: new Date(),
        locationTokenHash: null,
        encryptedLatestLocation: null,
        locationHealth: "unavailable",
      })
      .where(eq(trackingJourneysTable.id, journey.id))
      .returning();
    res.json(await journeyResponse(updated, child.displayName));
  } catch (error) {
    handleError(error, req, res);
  }
});

const expiryTimer = setInterval(() => {
  void expireJourneys().catch((error: unknown) => {
    logger.error({ err: error }, "Tracking journey expiry cleanup failed");
  });
}, 5 * 60 * 1000);
expiryTimer.unref();

export default router;