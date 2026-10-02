import { Router, type IRouter, type Response } from "express";
import {
  communityReportsTable,
  db,
} from "@workspace/db";
import {
  GetPublicReportHeatResponse,
  GetReportMapDataResponse,
} from "@workspace/api-zod";
import {
  authenticateAccount,
  canViewReport,
  HttpError,
  requireApprovedFamilyMember,
} from "../lib/pathpal-auth";

const router: IRouter = Router();
const HEAT_CELL_SIZE = 0.01;
const HEAT_MINIMUM_REPORTS = 3;

function sendError(res: Response, error: unknown, message: string): void {
  const status = error instanceof HttpError ? error.status : 500;
  res.status(status).json({
    error: error instanceof HttpError ? error.message : message,
  });
}

function heatCells(
  rows: { latitude: number | null; longitude: number | null }[],
) {
  const counts = new Map<string, { latitude: number; longitude: number; count: number }>();
  for (const row of rows) {
    if (
      row.latitude === null ||
      row.longitude === null ||
      !Number.isFinite(row.latitude) ||
      !Number.isFinite(row.longitude)
    ) continue;
    const latCell = Math.floor(row.latitude / HEAT_CELL_SIZE) * HEAT_CELL_SIZE;
    const lngCell = Math.floor(row.longitude / HEAT_CELL_SIZE) * HEAT_CELL_SIZE;
    const key = `${latCell},${lngCell}`;
    const cell = counts.get(key) ?? {
      latitude: latCell + HEAT_CELL_SIZE / 2,
      longitude: lngCell + HEAT_CELL_SIZE / 2,
      count: 0,
    };
    cell.count += 1;
    counts.set(key, cell);
  }
  const qualifyingCounts = [...counts.values()]
    .filter((cell) => cell.count >= HEAT_MINIMUM_REPORTS)
    .map((cell) => cell.count);
  const maxCount = Math.max(HEAT_MINIMUM_REPORTS, ...qualifyingCounts);
  return [...counts.values()]
    .filter((cell) => cell.count >= HEAT_MINIMUM_REPORTS)
    .map(({ latitude, longitude, count }) => ({
      latitude,
      longitude,
      intensity: Math.min(1, count / maxCount),
    }));
}

async function allHeatCells() {
  const rows = await db.select({
    latitude: communityReportsTable.latitude,
    longitude: communityReportsTable.longitude,
  }).from(communityReportsTable);
  return heatCells(rows);
}

router.get("/reports/map-data", async (req, res): Promise<void> => {
  try {
    const principal = await authenticateAccount(req);
    if (principal.role === "parent" || principal.role === "child") {
      requireApprovedFamilyMember(principal);
    }
    const rows = await db.select().from(communityReportsTable);
    const markers = rows.filter((row) =>
      row.latitude !== null &&
      row.longitude !== null &&
      canViewReport(principal, row)
    ).map((row) => ({
      id: row.id,
      latitude: row.latitude!,
      longitude: row.longitude!,
      severity: row.severity,
      status: row.status,
      assignedTeam: row.assignedTeam,
      routeAssignment: row.routeAssignment,
    }));
    res.json(GetReportMapDataResponse.parse({
      markers,
      publicHeat: await allHeatCells(),
    }));
  } catch (error) {
    sendError(res, error, "Authorized report map data could not be loaded.");
  }
});

router.get("/reports/public-heat", async (_req, res): Promise<void> => {
  try {
    res.json(GetPublicReportHeatResponse.parse(await allHeatCells()));
  } catch (error) {
    sendError(res, error, "Anonymous heat data could not be loaded.");
  }
});

export default router;