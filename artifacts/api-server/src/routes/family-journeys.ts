import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  ConfirmFamilyJourneyMilestoneBody,
  ConfirmFamilyJourneyMilestoneResponse,
  GetFamilyJourneyResponse,
  SaveFamilyJourneyBody,
  SaveFamilyJourneyResponse,
} from "@workspace/api-zod";
import { db, familyJourneysTable } from "@workspace/db";
import {
  authenticateAccount,
  HttpError,
  requireApprovedFamilyMember,
} from "../lib/pathpal-auth";

const router: IRouter = Router();

function sendError(res: Response, error: unknown, fallbackMessage: string): void {
  const status = error instanceof HttpError ? error.status : 500;
  res.status(status).json({
    error: error instanceof HttpError ? error.message : fallbackMessage,
  });
}

function cleanEndpointName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 200) {
    throw new HttpError(400, "Choose a valid starting and destination place.");
  }
  return cleaned;
}

function toApiJourney(row: typeof familyJourneysTable.$inferSelect | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    route: row.routeData,
    origin: {
      name: row.originName,
      latitude: row.originLatitude,
      longitude: row.originLongitude,
    },
    destination: {
      name: row.destinationName,
      latitude: row.destinationLatitude,
      longitude: row.destinationLongitude,
    },
    milestoneIndex: row.milestoneIndex,
    tripUpdatedAt: row.tripUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function milestoneCountForRoute(route: { mode: "walking" | "transit"; legs: Array<{ type: "walk" | "bus" }> }): number {
  if (route.mode === "walking" || route.legs.length === 0) return 2;
  return route.legs.reduce((count, leg) => count + (leg.type === "bus" ? 2 : 1), 0) +
    (route.legs.at(-1)?.type === "bus" ? 1 : 0);
}

router.get("/families/me/journey", async (req, res): Promise<void> => {
  try {
    const principal = await authenticateAccount(req);
    const familyId = requireApprovedFamilyMember(principal);
    const [journey] = await db.select().from(familyJourneysTable)
      .where(eq(familyJourneysTable.familyId, familyId)).limit(1);
    res.json(GetFamilyJourneyResponse.parse({ journey: toApiJourney(journey) }));
  } catch (error) {
    sendError(res, error, "The family's shared journey could not be loaded.");
  }
});

router.put("/families/me/journey", async (req, res): Promise<void> => {
  const parsed = SaveFamilyJourneyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid route and both trip endpoints." });
    return;
  }

  try {
    const principal = await authenticateAccount(req);
    const familyId = requireApprovedFamilyMember(principal);
    if (!parsed.data.route.available) {
      throw new HttpError(400, "Choose an available route before saving it.");
    }
    const now = new Date();
    const originName = cleanEndpointName(parsed.data.origin.name);
    const destinationName = cleanEndpointName(parsed.data.destination.name);
    const [journey] = await db.insert(familyJourneysTable).values({
      familyId,
      routeData: parsed.data.route,
      originName,
      originLatitude: parsed.data.origin.latitude,
      originLongitude: parsed.data.origin.longitude,
      destinationName,
      destinationLatitude: parsed.data.destination.latitude,
      destinationLongitude: parsed.data.destination.longitude,
      milestoneIndex: -1,
      tripUpdatedAt: null,
      createdByUserId: principal.userId,
      updatedByUserId: principal.userId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: familyJourneysTable.familyId,
      set: {
        routeData: parsed.data.route,
        originName,
        originLatitude: parsed.data.origin.latitude,
        originLongitude: parsed.data.origin.longitude,
        destinationName,
        destinationLatitude: parsed.data.destination.latitude,
        destinationLongitude: parsed.data.destination.longitude,
        milestoneIndex: -1,
        tripUpdatedAt: null,
        updatedByUserId: principal.userId,
        updatedAt: now,
      },
    }).returning();

    if (!journey) throw new Error("Saving the family journey returned no row.");
    res.json(SaveFamilyJourneyResponse.parse({ journey: toApiJourney(journey) }));
  } catch (error) {
    sendError(res, error, "The family's shared journey could not be saved.");
  }
});

router.post("/families/me/journey/check-ins", async (req, res): Promise<void> => {
  const parsed = ConfirmFamilyJourneyMilestoneBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid journey check-in." });
    return;
  }

  try {
    const principal = await authenticateAccount(req);
    const familyId = requireApprovedFamilyMember(principal);
    if (principal.role !== "child") {
      throw new HttpError(403, "Only an approved child may check in to a family journey.");
    }
    const [current] = await db.select().from(familyJourneysTable)
      .where(eq(familyJourneysTable.familyId, familyId)).limit(1);
    if (!current) throw new HttpError(404, "No family journey has been saved.");
    const validatedJourney = GetFamilyJourneyResponse.parse({ journey: toApiJourney(current) }).journey;
    if (!validatedJourney) throw new Error("The saved family journey is missing.");
    if (parsed.data.milestoneIndex >= milestoneCountForRoute(validatedJourney.route)) {
      throw new HttpError(400, "That check-in is not part of the saved route.");
    }
    if (parsed.data.milestoneIndex !== current.milestoneIndex + 1) {
      throw new HttpError(409, "Confirm journey check-ins in order.");
    }

    const now = new Date();
    const [journey] = await db.update(familyJourneysTable).set({
      milestoneIndex: parsed.data.milestoneIndex,
      tripUpdatedAt: now,
      updatedByUserId: principal.userId,
      updatedAt: now,
    }).where(and(
      eq(familyJourneysTable.id, current.id),
      eq(familyJourneysTable.milestoneIndex, current.milestoneIndex),
    )).returning();

    if (!journey) throw new HttpError(409, "Journey progress changed. Refresh and try again.");
    res.json(ConfirmFamilyJourneyMilestoneResponse.parse({ journey: toApiJourney(journey) }));
  } catch (error) {
    sendError(res, error, "The family journey check-in could not be saved.");
  }
});

export default router;