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
  authenticateAccount as authenticatePathPalAccount,
  HttpError,
  requireApprovedFamilyMember,
  type PathPalPrincipal,
} from "../lib/pathpal-auth";

export type FamilyJourneyRecord = typeof familyJourneysTable.$inferSelect;
export type NewFamilyJourneyRecord = typeof familyJourneysTable.$inferInsert;

export type FamilyJourneySaveUpdate = Pick<
  NewFamilyJourneyRecord,
  | "routeData"
  | "originName"
  | "originLatitude"
  | "originLongitude"
  | "destinationName"
  | "destinationLatitude"
  | "destinationLongitude"
  | "milestoneIndex"
  | "tripUpdatedAt"
  | "updatedByUserId"
  | "updatedAt"
>;

export type FamilyJourneyProgressUpdate = Pick<
  NewFamilyJourneyRecord,
  "milestoneIndex" | "tripUpdatedAt" | "updatedByUserId" | "updatedAt"
>;

export type FamilyJourneyStore = {
  findByFamilyId(familyId: string): Promise<FamilyJourneyRecord | undefined>;
  saveForFamily(
    insertValues: NewFamilyJourneyRecord,
    updateValues: FamilyJourneySaveUpdate,
  ): Promise<FamilyJourneyRecord | undefined>;
  advanceMilestone(
    journeyId: string,
    expectedMilestoneIndex: number,
    updateValues: FamilyJourneyProgressUpdate,
  ): Promise<FamilyJourneyRecord | undefined>;
};

type AccountAuthenticator = (req: Request) => Promise<PathPalPrincipal>;

const drizzleFamilyJourneyStore: FamilyJourneyStore = {
  async findByFamilyId(familyId) {
    const [journey] = await db.select().from(familyJourneysTable)
      .where(eq(familyJourneysTable.familyId, familyId)).limit(1);
    return journey;
  },
  async saveForFamily(insertValues, updateValues) {
    const [journey] = await db.insert(familyJourneysTable).values(insertValues)
      .onConflictDoUpdate({
        target: familyJourneysTable.familyId,
        set: updateValues,
      }).returning();
    return journey;
  },
  async advanceMilestone(journeyId, expectedMilestoneIndex, updateValues) {
    const [journey] = await db.update(familyJourneysTable).set(updateValues).where(and(
      eq(familyJourneysTable.id, journeyId),
      eq(familyJourneysTable.milestoneIndex, expectedMilestoneIndex),
    )).returning();
    return journey;
  },
};

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

function toApiJourney(row: FamilyJourneyRecord | undefined) {
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

export function createFamilyJourneysRouter(dependencies: {
  authenticateAccount?: AccountAuthenticator;
  store?: FamilyJourneyStore;
} = {}): IRouter {
  const authenticateAccount = dependencies.authenticateAccount ?? authenticatePathPalAccount;
  const store = dependencies.store ?? drizzleFamilyJourneyStore;
  const router: IRouter = Router();

  router.get("/families/me/journey", async (req, res): Promise<void> => {
    try {
      const principal = await authenticateAccount(req);
      const familyId = requireApprovedFamilyMember(principal);
      const journey = await store.findByFamilyId(familyId);
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
      const journey = await store.saveForFamily({
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
      }, {
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
      });

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
      const current = await store.findByFamilyId(familyId);
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
      const journey = await store.advanceMilestone(current.id, current.milestoneIndex, {
        milestoneIndex: parsed.data.milestoneIndex,
        tripUpdatedAt: now,
        updatedByUserId: principal.userId,
        updatedAt: now,
      });

      if (!journey) throw new HttpError(409, "Journey progress changed. Refresh and try again.");
      res.json(ConfirmFamilyJourneyMilestoneResponse.parse({ journey: toApiJourney(journey) }));
    } catch (error) {
      sendError(res, error, "The family journey check-in could not be saved.");
    }
  });

  return router;
}

export default createFamilyJourneysRouter();