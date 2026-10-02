import {
  createCipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import {
  CreateTrackingFamilyBody,
  CreateTrackingJourneyBody,
  CreateTrackingJourneyResponse,
  GetTrackingProfileResponse,
  JoinTrackingFamilyBody,
  OptInToTrackingJourneyResponse,
  OptInToTrackingJourneyParams,
  RecordTrackingCheckinResponse,
  RecordTrackingCheckinBody,
  UpdateTrackingLocationResponse,
  UpdateTrackingLocationBody,
} from "@workspace/api-zod";
import type {
  TrackingJourneyEvent,
  TrackingProfileResponse,
  TrackingRoute,
} from "@workspace/api-zod";
import {
  db,
  trackingChildrenTable,
  trackingFamiliesTable,
  trackingJourneyEventsTable,
  trackingJourneysTable,
  type TrackingJourneyRow,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
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

const clerkAuthMiddleware = clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(
    getClerkProxyHost(req) ?? "",
    process.env.CLERK_PUBLISHABLE_KEY,
  ),
}));

router.use((req, res, next) => {
  const requestPath = req.originalUrl.split("?")[0];
  const isLocationSessionUpload =
    req.method === "POST" &&
    /\/tracking\/journeys\/[^/]+\/locations\/?$/.test(requestPath);
  if (isLocationSessionUpload) {
    next();
    return;
  }
  clerkAuthMiddleware(req, res, next);
});

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

function requireClerkUser(req: Request): string {
  const userId = getAuth(req).userId;
  if (!userId) fail(401, "Sign in to your separate PathPal tracking account.");
  return userId;
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

async function profileForUser(userId: string) {
  await expireJourneys();

  const [family] = await db
    .select()
    .from(trackingFamiliesTable)
    .where(eq(trackingFamiliesTable.ownerUserId, userId))
    .limit(1);

  if (family) {
    const children = await db
      .select()
      .from(trackingChildrenTable)
      .where(eq(trackingChildrenTable.familyId, family.id))
      .orderBy(asc(trackingChildrenTable.createdAt));
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
      invitationCode: family.invitationCode,
      children: children.map(({ id, displayName }) => ({ id, name: displayName })),
      journeys: summaries.map(({ journey }) => journey),
    });
  }

  const [child] = await db
    .select()
    .from(trackingChildrenTable)
    .where(eq(trackingChildrenTable.userId, userId))
    .limit(1);
  if (!child) fail(404, "This tracking account has not joined a family yet.");

  const [childFamily] = await db
    .select()
    .from(trackingFamiliesTable)
    .where(eq(trackingFamiliesTable.id, child.familyId))
    .limit(1);
  if (!childFamily) fail(404, "The tracking family is no longer available.");

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
    familyId: childFamily.id,
    familyName: childFamily.familyName,
    invitationCode: null,
    children: [],
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
  userId: string,
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

  const isParent = family.ownerUserId === userId;
  const isChild = child.userId === userId;
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
    res.json(await profileForUser(requireClerkUser(req)));
  } catch (error) {
    handleError(error, req, res);
  }
});

router.post("/tracking/family", async (req, res): Promise<void> => {
  const parsed = CreateTrackingFamilyBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.familyName.trim()) {
    res.status(400).json({ error: "Enter a valid family name." });
    return;
  }
  try {
    const userId = requireClerkUser(req);
    const [existingParent] = await db.select({ id: trackingFamiliesTable.id })
      .from(trackingFamiliesTable)
      .where(eq(trackingFamiliesTable.ownerUserId, userId))
      .limit(1);
    const [existingChild] = await db.select({ id: trackingChildrenTable.id })
      .from(trackingChildrenTable)
      .where(eq(trackingChildrenTable.userId, userId))
      .limit(1);
    if (existingParent || existingChild) {
      fail(409, "This tracking account already belongs to a family.");
    }

    let family: typeof trackingFamiliesTable.$inferSelect | undefined;
    for (let attempt = 0; attempt < 8 && !family; attempt += 1) {
      [family] = await db
        .insert(trackingFamiliesTable)
        .values({
          ownerUserId: userId,
          familyName: parsed.data.familyName.trim(),
          invitationCode: createInvitationCode(),
        })
        .onConflictDoNothing()
        .returning();
    }
    if (!family) fail(503, "A unique family invitation could not be generated.");
    res.status(201).json(await profileForUser(userId));
  } catch (error) {
    handleError(error, req, res);
  }
});

router.post("/tracking/family/join", async (req, res): Promise<void> => {
  const parsed = JoinTrackingFamilyBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.invitationCode.trim() || !parsed.data.displayName.trim()) {
    res.status(400).json({ error: "Enter the family code and your display name." });
    return;
  }
  try {
    const userId = requireClerkUser(req);
    const [alreadyParent] = await db.select({ id: trackingFamiliesTable.id })
      .from(trackingFamiliesTable)
      .where(eq(trackingFamiliesTable.ownerUserId, userId))
      .limit(1);
    const [alreadyChild] = await db.select({ id: trackingChildrenTable.id })
      .from(trackingChildrenTable)
      .where(eq(trackingChildrenTable.userId, userId))
      .limit(1);
    if (alreadyParent || alreadyChild) fail(409, "This tracking account already belongs to a family.");

    const [family] = await db
      .select()
      .from(trackingFamiliesTable)
      .where(eq(trackingFamiliesTable.invitationCode, parsed.data.invitationCode.trim()))
      .limit(1);
    if (!family) fail(404, "That tracking family invitation was not found.");

    const [child] = await db
      .insert(trackingChildrenTable)
      .values({
        familyId: family.id,
        userId,
        displayName: parsed.data.displayName.trim(),
      })
      .onConflictDoNothing()
      .returning();
    if (!child) fail(409, "This account could not be added as a child member.");
    res.json(await profileForUser(userId));
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
    const userId = requireClerkUser(req);
    const [family] = await db
      .select()
      .from(trackingFamiliesTable)
      .where(eq(trackingFamiliesTable.ownerUserId, userId))
      .limit(1);
    if (!family) fail(403, "Only the parent account can approve a live journey.");
    const [child] = await db
      .select()
      .from(trackingChildrenTable)
      .where(and(
        eq(trackingChildrenTable.id, parsed.data.childId),
        eq(trackingChildrenTable.familyId, family.id),
      ))
      .limit(1);
    if (!child) fail(403, "Choose a child in this tracking family.");

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
        familyId: family.id,
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
      "parent-approved",
      "Journey approved",
      `Waiting for ${child.displayName} to opt in.`,
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
    const userId = requireClerkUser(req);
    const { journey, child } = await getJourneyForUser(journeyId, userId, "child");
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
    const userId = requireClerkUser(req);
    const { journey, child } = await getJourneyForUser(journeyId, userId, "child");
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
    const userId = requireClerkUser(req);
    const { journey, child } = await getJourneyForUser(journeyId, userId, "child");
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
    const userId = requireClerkUser(req);
    const { journey, child } = await getJourneyForUser(journeyId, userId, "either");
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