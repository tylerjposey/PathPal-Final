import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  communityReportsTable,
  communityReportStatusEventsTable,
  type CommunityReportRow,
} from "@workspace/db";
import {
  CreateReportBody,
  CreateReportResponse,
  CreateReportSessionBody,
  CreateReportSessionResponse,
  GetReportParams,
  GetReportResponse,
  GetReportPhotoParams,
  ListReportsResponse,
  ResetDemoReportsResponse,
  UpdateReportBody,
  UpdateReportParams,
  UpdateReportResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const RATE_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT = 5;
const rateBuckets = new Map<string, number[]>();
const locations = [
  { name: "Downtown San Jose", x: 48, y: 43, latitude: 37.3382, longitude: -121.8863 },
  { name: "Japantown", x: 35, y: 25, latitude: 37.3481, longitude: -121.8958 },
  { name: "Willow Glen", x: 29, y: 69, latitude: 37.3058, longitude: -121.9002 },
  { name: "East San Jose", x: 76, y: 58, latitude: 37.3514, longitude: -121.8277 },
  { name: "Alum Rock", x: 79, y: 27, latitude: 37.3666, longitude: -121.8272 },
  { name: "Santa Clara", x: 17, y: 45, latitude: 37.3541, longitude: -121.9552 },
] as const;
const westCleanTeam = "San Jose – West Clean Team";
const demoFamilyId = "demo-family-ai4sg";
const demoCitizenId = "demo-citizen-ai4sg";
const storage = new Storage({
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

type Role = "parent" | "child" | "citizen" | "manager" | "worker";
type Claims = { role: Role; sub: string; familyId: string | null; exp: number };
type SeedRow = {
  id: string;
  category: string;
  description: string;
  severity: number;
  status: string;
  location: (typeof locations)[number]["name"];
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  hoursAgo: number;
  assignedTeam: string | null;
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const seed: SeedRow[] = [
  { id: "OR-2481", category: "Illegal dumping", description: "Several bags and loose debris beside the trail entrance.", severity: 9, status: "Assigned", location: "Downtown San Jose", x: 49, y: 42, latitude: 37.3391, longitude: -121.8871, hoursAgo: 7, assignedTeam: westCleanTeam },
  { id: "OR-2478", category: "Poor lighting", description: "The pedestrian crossing near the stop is very dark after sunset.", severity: 7, status: "Under Review", location: "Japantown", x: 37, y: 29, latitude: 37.3487, longitude: -121.8963, hoursAgo: 18, assignedTeam: null },
  { id: "OR-2474", category: "Damaged sidewalks", description: "Raised pavement near the school crossing could be a trip hazard.", severity: 6, status: "Submitted", location: "Willow Glen", x: 31, y: 70, latitude: 37.3061, longitude: -121.9011, hoursAgo: 29, assignedTeam: null },
  { id: "OR-2469", category: "Blight", description: "Litter around the park entrance has now been cleared.", severity: 3, status: "Resolved", location: "Alum Rock", x: 78, y: 26, latitude: 37.3672, longitude: -121.8281, hoursAgo: 75, assignedTeam: "Parks Response Team" },
  { id: "OR-2463", category: "Unsafe bus stops", description: "The sidewalk at the northbound stop is cracked and difficult to navigate.", severity: 6, status: "Assigned", location: "East San Jose", x: 76, y: 60, latitude: 37.3522, longitude: -121.8285, hoursAgo: 49, assignedTeam: westCleanTeam },
  { id: "OR-2459", category: "Other concerns", description: "A recycling bin is overflowing at the transit plaza.", severity: 4, status: "Submitted", location: "Santa Clara", x: 18, y: 47, latitude: 37.3545, longitude: -121.956, hoursAgo: 92, assignedTeam: null },
];
const demoIds = seed.map(({ id }) => id);

function reportResponse(row: CommunityReportRow) {
  return {
    id: row.id,
    category: row.category,
    summary: row.summary,
    description: row.description,
    severity: row.severity,
    status: row.status,
    location: row.location,
    x: row.x,
    y: row.y,
    photoUri: row.photoObjectKey ? `/api/reports/${encodeURIComponent(row.id)}/photo` : null,
    photoReference: row.photoReference || "No photo provided",
    submittedAt: row.submittedAt,
    recommendedDepartment: row.recommendedDepartment,
    priority: row.priority,
    assignedTeam: row.assignedTeam,
    awardedPoints: row.awardedPoints,
    reporterAccountId: row.reporterAccountId,
    familyAccountId: row.familyAccountId,
    selectedCategory: row.selectedCategory,
    latitude: row.latitude,
    longitude: row.longitude,
    managerNotes: row.managerNotes,
    routeAssignment: row.routeAssignment,
    updatedAt: row.updatedAt,
    assignedAt: row.assignedAt,
    resolvedAt: row.resolvedAt,
  };
}

function analyze(description: string, selectedCategory?: string | null) {
  const text = description.toLowerCase();
  const category = selectedCategory ?? (
    text.includes("dump") || text.includes("bags") || text.includes("debris") ? "Illegal dumping" :
      text.includes("light") || text.includes("dark") ? "Poor lighting" :
        text.includes("sidewalk") || text.includes("crack") || text.includes("pavement") ? "Damaged sidewalks" :
          text.includes("bus stop") || text.includes("transit") ? "Unsafe bus stops" :
            text.includes("suspicious") ? "Suspicious activity" : "Other concerns"
  );
  const alarming = /unsafe|danger|broken|dark|trip|glass|traffic|sharp/.test(text);
  const severity = Math.min(10, Math.max(2, (alarming ? 7 : 4) + (description.length > 115 ? 1 : 0)));
  return {
    category,
    severity,
    priority: severity >= 8 ? "High" : severity >= 5 ? "Medium" : "Low",
    recommendedDepartment: category === "Poor lighting" || category === "Unsafe bus stops"
      ? "Transportation & Public Works"
      : category === "Damaged sidewalks" ? "Public Works" : "Environmental Services",
  };
}

function statusPath(status: string): string[] {
  if (status === "Under Review") return ["Submitted", "Under Review"];
  if (status === "Assigned") return ["Submitted", "Under Review", "Assigned"];
  if (status === "Resolved") return ["Submitted", "Under Review", "Assigned", "Resolved"];
  return ["Submitted"];
}

async function replaceSeedHistory(report: SeedRow, changedAt: Date): Promise<void> {
  await db.delete(communityReportStatusEventsTable).where(eq(communityReportStatusEventsTable.reportId, report.id));
  const path = statusPath(report.status);
  await db.insert(communityReportStatusEventsTable).values(path.map((toStatus, index) => ({
    reportId: report.id,
    fromStatus: index === 0 ? null : path[index - 1],
    toStatus,
    changedBy: "demo-seed",
    changedAt: new Date(changedAt.getTime() + index),
  })));
}

async function seedInitialReportsIdempotently(): Promise<void> {
  const now = Date.now();
  for (const report of seed) {
    const analysis = analyze(report.description, report.category);
    const submittedAt = new Date(now - report.hoursAgo * 3_600_000);
    await db.insert(communityReportsTable).values({
      id: report.id,
      category: analysis.category,
      selectedCategory: report.category,
      summary: report.description,
      description: report.description,
      severity: report.severity,
      status: report.status,
      location: report.location,
      x: report.x,
      y: report.y,
      latitude: report.latitude,
      longitude: report.longitude,
      photoReference: "No photo provided",
      submittedAt,
      updatedAt: submittedAt,
      recommendedDepartment: analysis.recommendedDepartment,
      priority: report.severity >= 8 ? "High" : report.severity >= 5 ? "Medium" : "Low",
      assignedTeam: report.assignedTeam,
      awardedPoints: report.status === "Resolved",
      reporterAccountId: demoCitizenId,
      familyAccountId: demoFamilyId,
      assignedAt: report.status === "Assigned" || report.status === "Resolved" ? submittedAt : null,
      resolvedAt: report.status === "Resolved" ? submittedAt : null,
    }).onConflictDoNothing();
    const [existing] = await db.select().from(communityReportsTable)
      .where(eq(communityReportsTable.id, report.id)).limit(1);
    if (!existing) continue;
    const missingFields: Partial<typeof communityReportsTable.$inferInsert> = {};
    if (existing.latitude == null) missingFields.latitude = report.latitude;
    if (existing.longitude == null) missingFields.longitude = report.longitude;
    if (existing.reporterAccountId == null) missingFields.reporterAccountId = demoCitizenId;
    if (existing.familyAccountId == null) missingFields.familyAccountId = demoFamilyId;
    if (existing.selectedCategory == null) missingFields.selectedCategory = report.category;
    if (existing.photoReference == null) missingFields.photoReference = "No photo provided";
    if (existing.assignedAt == null && (existing.status === "Assigned" || existing.status === "Resolved")) {
      missingFields.assignedAt = existing.submittedAt;
    }
    if (existing.resolvedAt == null && existing.status === "Resolved") missingFields.resolvedAt = existing.submittedAt;
    if (Object.keys(missingFields).length) {
      await db.update(communityReportsTable).set(missingFields).where(eq(communityReportsTable.id, report.id));
    }
    const [event] = await db.select({ id: communityReportStatusEventsTable.id })
      .from(communityReportStatusEventsTable)
      .where(eq(communityReportStatusEventsTable.reportId, report.id)).limit(1);
    if (!event) await replaceSeedHistory({ ...report, status: existing.status }, existing.submittedAt);
  }
}

async function restoreDemoReports(): Promise<CommunityReportRow[]> {
  const now = Date.now();
  const restored: CommunityReportRow[] = [];
  for (const report of seed) {
    const analysis = analyze(report.description, report.category);
    const submittedAt = new Date(now - report.hoursAgo * 3_600_000);
    const [row] = await db.insert(communityReportsTable).values({
      id: report.id,
      category: analysis.category,
      selectedCategory: report.category,
      summary: report.description,
      description: report.description,
      severity: report.severity,
      status: report.status,
      location: report.location,
      x: report.x,
      y: report.y,
      latitude: report.latitude,
      longitude: report.longitude,
      photoObjectKey: null,
      photoContentType: null,
      photoReference: "No photo provided",
      submittedAt,
      updatedAt: submittedAt,
      recommendedDepartment: analysis.recommendedDepartment,
      priority: report.severity >= 8 ? "High" : report.severity >= 5 ? "Medium" : "Low",
      assignedTeam: report.assignedTeam,
      awardedPoints: report.status === "Resolved",
      reporterAccountId: demoCitizenId,
      familyAccountId: demoFamilyId,
      managerNotes: null,
      routeAssignment: null,
      assignedAt: report.status === "Assigned" || report.status === "Resolved" ? submittedAt : null,
      resolvedAt: report.status === "Resolved" ? submittedAt : null,
    }).onConflictDoUpdate({
      target: communityReportsTable.id,
      set: {
        category: analysis.category,
        selectedCategory: report.category,
        summary: report.description,
        description: report.description,
        severity: report.severity,
        status: report.status,
        location: report.location,
        x: report.x,
        y: report.y,
        latitude: report.latitude,
        longitude: report.longitude,
        photoObjectKey: null,
        photoContentType: null,
        photoReference: "No photo provided",
        submittedAt,
        updatedAt: submittedAt,
        recommendedDepartment: analysis.recommendedDepartment,
        priority: report.severity >= 8 ? "High" : report.severity >= 5 ? "Medium" : "Low",
        assignedTeam: report.assignedTeam,
        awardedPoints: report.status === "Resolved",
        reporterAccountId: demoCitizenId,
        familyAccountId: demoFamilyId,
        managerNotes: null,
        routeAssignment: null,
        assignedAt: report.status === "Assigned" || report.status === "Resolved" ? submittedAt : null,
        resolvedAt: report.status === "Resolved" ? submittedAt : null,
      },
    }).returning();
    await replaceSeedHistory(report, submittedAt);
    restored.push(row);
  }
  return restored;
}

function createToken(claims: Claims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function authenticate(req: Request): Claims {
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
    if (!roles.includes(claims.role) || !claims.sub || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("invalid");
    return claims;
  } catch {
    throw new HttpError(401, "A valid bearer session is required.");
  }
}

function canView(claims: Claims, row: CommunityReportRow): boolean {
  if (claims.role === "manager") return true;
  if (claims.role === "worker") return row.assignedTeam === westCleanTeam;
  if (claims.role === "citizen") return row.reporterAccountId === claims.sub;
  if (claims.role === "parent" || claims.role === "child") return row.familyAccountId === claims.familyId;
  return false;
}

function requireView(claims: Claims, row: CommunityReportRow): void {
  if (!canView(claims, row)) throw new HttpError(403, "You are not authorized to view this report.");
}

function storageLocation(): { bucket: string; prefix: string } {
  const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const rawPrivateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucket || !rawPrivateDir) throw new HttpError(503, "Private photo storage is not configured.");
  const parts = rawPrivateDir.split("/").filter(Boolean);
  if (parts[0] === bucket) parts.shift();
  return { bucket, prefix: parts.join("/") };
}

function decodePhoto(encoded: string, contentType: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new HttpError(400, "Photo data must be valid base64.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > PHOTO_MAX_BYTES) throw new HttpError(413, "Photo must be no larger than 2 MB.");
  if (bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new HttpError(400, "Photo data must be valid base64.");
  }
  const validSignature =
    (contentType === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (contentType === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (contentType === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
  if (!validSignature) throw new HttpError(400, "Photo bytes do not match the declared image content type.");
  return bytes;
}

function enforceCreateRateLimit(ip: string): void {
  const now = Date.now();
  for (const [key, values] of rateBuckets) {
    const active = values.filter((time) => time > now - RATE_WINDOW_MS);
    if (active.length) rateBuckets.set(key, active);
    else rateBuckets.delete(key);
  }
  const attempts = rateBuckets.get(ip) ?? [];
  if (attempts.length >= RATE_LIMIT) throw new HttpError(429, "Report submission limit reached. Please try again later.");
  attempts.push(now);
  rateBuckets.set(ip, attempts);
}

function reportLocation(name: string | undefined, latitude: number, longitude: number) {
  const selected = locations.find((item) => item.name === name);
  if (selected) return selected;
  return locations.reduce((nearest, location) => {
    const distance = (location.latitude - latitude) ** 2 + ((location.longitude - longitude) * Math.cos(latitude * Math.PI / 180)) ** 2;
    const nearestDistance = (nearest.latitude - latitude) ** 2 + ((nearest.longitude - longitude) * Math.cos(latitude * Math.PI / 180)) ** 2;
    return distance < nearestDistance ? location : nearest;
  }, locations[0]);
}

function errorResponse(error: unknown, res: Response): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: "The report request could not be completed." });
}

router.get("/reports", async (req, res): Promise<void> => {
  try {
    const claims = authenticate(req);
    await seedInitialReportsIdempotently();
    const rows = await db.select().from(communityReportsTable).orderBy(desc(communityReportsTable.submittedAt));
    res.json(ListReportsResponse.parse(rows.filter((row) => canView(claims, row)).map(reportResponse)));
  } catch (error) {
    req.log.error({ err: error instanceof Error ? error.message : "unknown" }, "Community reports list failed");
    errorResponse(error, res);
  }
});

router.post("/reports", async (req, res): Promise<void> => {
  let uploadedKey: string | undefined;
  try {
    const claims = authenticate(req);
    if (!["parent", "child", "citizen"].includes(claims.role)) throw new HttpError(403, "Only parent, child, or citizen demo roles may submit reports.");
    if (process.env.NODE_ENV !== "development") {
      enforceCreateRateLimit(req.ip || req.socket.remoteAddress || "unknown");
    }
    const parsed = CreateReportBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid community report input.");
    const { description: rawDescription, location: locationName, category, photoBase64, contentType, latitude, longitude } = parsed.data;
    const description = rawDescription.trim();
    if (description.length < 12) throw new HttpError(400, "Description must contain at least 12 non-whitespace characters.");
    if ((photoBase64 == null) !== (contentType == null)) throw new HttpError(400, "Provide both photoBase64 and contentType when attaching a photo.");
    // The dropped pin is authoritative; the optional area hint must not mislabel its coordinates.
    const mapPin = reportLocation(undefined, latitude, longitude);
    const id = `OR-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    let photoObjectKey: string | null = null;
    let photoContentType: string | null = null;
    if (photoBase64 !== undefined && contentType !== undefined) {
      const bytes = decodePhoto(photoBase64, contentType);
      try {
        const { bucket, prefix } = storageLocation();
        const extension = contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length);
        photoObjectKey = `${prefix ? `${prefix}/` : ""}reports/${randomUUID()}.${extension}`;
        await storage.bucket(bucket).file(photoObjectKey).save(bytes, {
          resumable: false,
          metadata: { contentType, cacheControl: "private, no-store" },
        });
        photoContentType = contentType;
        uploadedKey = photoObjectKey;
      } catch {
        throw new HttpError(503, "Photo could not be stored. Please try again.");
      }
    }
    const analysis = analyze(description, category);
    const submittedAt = new Date();
    const familyAccountId = claims.role === "parent" || claims.role === "child" ? claims.familyId : null;
    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(communityReportsTable).values({
        id,
        category: analysis.category,
        selectedCategory: category ?? null,
        summary: description.slice(0, 105),
        description,
        severity: analysis.severity,
        status: "Submitted",
        location: mapPin.name,
        x: Math.round(((longitude + 122.2) / 0.6) * 100),
        y: Math.round(((37.6 - latitude) / 0.6) * 100),
        latitude,
        longitude,
        photoObjectKey,
        photoContentType,
        photoReference: photoObjectKey ? photoObjectKey.split("/").at(-1)! : "No photo provided",
        submittedAt,
        updatedAt: submittedAt,
        recommendedDepartment: analysis.recommendedDepartment,
        priority: analysis.priority,
        reporterAccountId: claims.sub,
        familyAccountId,
        assignedAt: null,
        resolvedAt: null,
      }).returning();
      if (!inserted) throw new Error("Report insert returned no row.");
      await tx.insert(communityReportStatusEventsTable).values({
        reportId: id, fromStatus: null, toStatus: "Submitted", changedBy: claims.sub, changedAt: submittedAt,
      });
      return inserted;
    });
    res.status(201).json(CreateReportResponse.parse(reportResponse(created)));
  } catch (error) {
    if (uploadedKey) {
      try {
        const [committedReport] = await db.select({ id: communityReportsTable.id })
          .from(communityReportsTable)
          .where(eq(communityReportsTable.photoObjectKey, uploadedKey))
          .limit(1);
        if (committedReport) {
          req.log.warn({ reportId: committedReport.id }, "Retaining uploaded photo referenced by a committed report");
        } else {
          const { bucket } = storageLocation();
          await storage.bucket(bucket).file(uploadedKey).delete();
        }
      } catch {
        // Keep the object if commit state cannot be verified; avoid breaking a committed report.
        req.log.warn("Could not verify report photo commit state; retaining uploaded photo");
      }
    }
    if (error instanceof HttpError) {
      if (error.status === 429) res.setHeader("Retry-After", "900");
      errorResponse(error, res);
      return;
    }
    req.log.error({ err: error instanceof Error ? error.message : "unknown" }, "Community report creation failed");
    errorResponse(error, res);
  }
});

router.post("/reports/session", (req, res): void => {
  const parsed = CreateReportSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid session input." });
    return;
  }
  if (parsed.data.username.trim().toLowerCase() !== "ai4sg" || parsed.data.password !== "1234") {
    res.status(401).json({ error: "Invalid demo credentials." });
    return;
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    res.status(503).json({ error: "Demo session signing is not configured." });
    return;
  }
  const role = parsed.data.role;
  const sub = role === "parent" ? "demo-family-parent-ai4sg"
    : role === "child" ? "demo-family-child-ai4sg"
      : role === "citizen" ? demoCitizenId
        : role === "manager" ? "Avery Patel" : "Luis Rivera";
  const familyId = role === "parent" || role === "child" ? demoFamilyId : null;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
  const accessToken = createToken({ role, sub, familyId, exp: Math.floor(expiresAt.getTime() / 1000) }, secret);
  res.json(CreateReportSessionResponse.parse({ accessToken, tokenType: "Bearer", expiresAt, role, prototypeOnly: true }));
});

router.get("/reports/:id", async (req, res): Promise<void> => {
  try {
    const params = GetReportParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Invalid report ID.");
    const claims = authenticate(req);
    const [row] = await db.select().from(communityReportsTable)
      .where(eq(communityReportsTable.id, params.data.id)).limit(1);
    if (!row) throw new HttpError(404, "Report not found.");
    requireView(claims, row);
    const history = await db.select({
      fromStatus: communityReportStatusEventsTable.fromStatus,
      toStatus: communityReportStatusEventsTable.toStatus,
      changedBy: communityReportStatusEventsTable.changedBy,
      changedAt: communityReportStatusEventsTable.changedAt,
    }).from(communityReportStatusEventsTable)
      .where(eq(communityReportStatusEventsTable.reportId, row.id))
      .orderBy(asc(communityReportStatusEventsTable.changedAt), asc(communityReportStatusEventsTable.id));
    res.json(GetReportResponse.parse({ ...reportResponse(row), statusHistory: history }));
  } catch (error) {
    errorResponse(error, res);
  }
});

router.patch("/reports/:id", async (req, res): Promise<void> => {
  try {
    const params = UpdateReportParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Invalid report ID.");
    const claims = authenticate(req);
    if (claims.role !== "manager" && claims.role !== "worker") throw new HttpError(403, "This role may not edit reports.");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new HttpError(400, "Provide a valid report update.");
    const allowedKeys = new Set(["description", "category", "severity", "location", "status", "assignedTeam", "managerNotes", "routeAssignment", "latitude", "longitude"]);
    if (Object.keys(req.body).some((key) => !allowedKeys.has(key))) throw new HttpError(400, "Report update contains unsupported fields.");
    const parsed = UpdateReportBody.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) throw new HttpError(400, "Provide at least one valid report update.");
    const update = parsed.data;
    if ((update.latitude === undefined) !== (update.longitude === undefined)) throw new HttpError(400, "Provide both latitude and longitude when moving the map pin.");
    if (claims.role === "worker" && (Object.keys(update).some((key) => key !== "status") || !update.status)) {
      throw new HttpError(403, "Workers may update only report status.");
    }
    const [current] = await db.select().from(communityReportsTable)
      .where(eq(communityReportsTable.id, params.data.id)).limit(1);
    if (!current) throw new HttpError(404, "Report not found.");
    if (claims.role === "worker" && current.assignedTeam !== westCleanTeam) {
      throw new HttpError(403, "Workers may update reports assigned to the West Clean Team.");
    }
    const changes: Partial<typeof communityReportsTable.$inferInsert> = { updatedAt: new Date() };
    if (update.description !== undefined) {
      changes.description = update.description.trim();
      changes.summary = update.description.trim().slice(0, 105);
    }
    if (update.category !== undefined) {
      changes.category = update.category;
      changes.recommendedDepartment = analyze(current.description, update.category).recommendedDepartment;
    }
    if (update.severity !== undefined) {
      changes.severity = update.severity;
      changes.priority = update.severity >= 8 ? "High" : update.severity >= 5 ? "Medium" : "Low";
    }
    if (update.location !== undefined) {
      const found = locations.find((item) => item.name === update.location);
      if (!found) throw new HttpError(400, "Location is not supported.");
      changes.location = found.name;
      changes.x = found.x;
      changes.y = found.y;
      changes.latitude = found.latitude;
      changes.longitude = found.longitude;
    }
    if (update.latitude !== undefined && update.longitude !== undefined) {
      changes.latitude = update.latitude;
      changes.longitude = update.longitude;
      changes.location = reportLocation(undefined, update.latitude, update.longitude).name;
      changes.x = Math.round(((update.longitude + 122.2) / 0.6) * 100);
      changes.y = Math.round(((37.6 - update.latitude) / 0.6) * 100);
    }
    if (update.status !== undefined) {
      changes.status = update.status;
      if (update.status === "Assigned" && current.status !== "Assigned") changes.assignedAt = new Date();
      if (update.status === "Resolved" && current.status !== "Resolved") changes.resolvedAt = new Date();
      if (update.status !== "Resolved" && current.status === "Resolved") changes.resolvedAt = null;
    }
    if (update.assignedTeam !== undefined) {
      changes.assignedTeam = update.assignedTeam;
      if (update.assignedTeam && current.status !== "Assigned" && update.status !== "Assigned") changes.assignedAt = new Date();
    }
    if (update.managerNotes !== undefined) changes.managerNotes = update.managerNotes;
    if (update.routeAssignment !== undefined) changes.routeAssignment = update.routeAssignment;
    const newlyAwarded = update.status === "Resolved" && current.status !== "Resolved" && !current.awardedPoints;
    if (newlyAwarded) changes.awardedPoints = true;
    const [updated] = await db.update(communityReportsTable).set(changes)
      .where(and(
        eq(communityReportsTable.id, params.data.id),
        ...(newlyAwarded ? [eq(communityReportsTable.awardedPoints, false)] : []),
      )).returning();
    const [latest] = updated ? [updated] : await db.select().from(communityReportsTable)
      .where(eq(communityReportsTable.id, params.data.id)).limit(1);
    if (!latest) throw new HttpError(404, "Report not found.");
    if (update.status !== undefined && update.status !== current.status) {
      await db.insert(communityReportStatusEventsTable).values({
        reportId: current.id,
        fromStatus: current.status,
        toStatus: update.status,
        changedBy: claims.sub,
        changedAt: latest.updatedAt,
      });
    }
    res.json(UpdateReportResponse.parse({
      report: reportResponse(latest),
      awardedPoints: Boolean(updated && newlyAwarded),
    }));
  } catch (error) {
    if (error instanceof HttpError) {
      errorResponse(error, res);
      return;
    }
    req.log.error({ err: error instanceof Error ? error.message : "unknown" }, "Community report update failed");
    errorResponse(error, res);
  }
});

router.post("/reports/demo/reset", async (req, res): Promise<void> => {
  try {
    const claims = authenticate(req);
    if (claims.role !== "manager") throw new HttpError(403, "Only the manager demo role may reset demonstration reports.");
    const rows = await restoreDemoReports();
    res.json(ResetDemoReportsResponse.parse(rows.map(reportResponse)));
  } catch (error) {
    errorResponse(error, res);
  }
});

router.get("/reports/:id/photo", async (req, res): Promise<void> => {
  try {
    const params = GetReportPhotoParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Invalid report ID.");
    const claims = authenticate(req);
    const [report] = await db.select().from(communityReportsTable)
      .where(eq(communityReportsTable.id, params.data.id)).limit(1);
    if (!report) throw new HttpError(404, "Report not found.");
    requireView(claims, report);
    if (!report.photoObjectKey || !report.photoContentType || !["image/jpeg", "image/png", "image/webp"].includes(report.photoContentType)) {
      throw new HttpError(404, "Report photo not found.");
    }
    const { bucket } = storageLocation();
    const file = storage.bucket(bucket).file(report.photoObjectKey);
    const [exists] = await file.exists();
    if (!exists) throw new HttpError(404, "Report photo not found.");
    res.setHeader("Content-Type", report.photoContentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    file.createReadStream()
      .on("error", () => {
        if (!res.headersSent) res.status(503).json({ error: "Photo could not be streamed." });
        else res.destroy();
      })
      .pipe(res);
  } catch (error) {
    if (error instanceof HttpError) {
      errorResponse(error, res);
      return;
    }
    req.log.error({ err: error instanceof Error ? error.message : "unknown" }, "Community report photo retrieval failed");
    errorResponse(error, res);
  }
});

export default router;