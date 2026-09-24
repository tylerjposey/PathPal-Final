import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, communityReportsTable, type CommunityReportRow } from "@workspace/db";
import {
  CreateReportBody,
  CreateReportResponse,
  CreateReportSessionBody,
  CreateReportSessionResponse,
  GetReportPhotoParams,
  ListReportsResponse,
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
  { name: "Downtown San Jose", x: 48, y: 43 },
  { name: "Japantown", x: 35, y: 25 },
  { name: "Willow Glen", x: 29, y: 69 },
  { name: "East San Jose", x: 76, y: 58 },
  { name: "Alum Rock", x: 79, y: 27 },
  { name: "Santa Clara", x: 17, y: 45 },
] as const;
const westCleanTeam = "San Jose – West Clean Team";
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

type Role = "manager" | "worker";
type Claims = { role: Role; sub: string; exp: number };

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

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
    submittedAt: row.submittedAt,
    recommendedDepartment: row.recommendedDepartment,
    priority: row.priority,
    assignedTeam: row.assignedTeam,
    awardedPoints: row.awardedPoints,
  };
}

function analyze(description: string, selectedCategory?: string) {
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

function storageLocation(): { bucket: string; prefix: string } {
  const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const rawPrivateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucket || !rawPrivateDir) {
    throw new HttpError(503, "Private photo storage is not configured.");
  }
  const parts = rawPrivateDir.split("/").filter(Boolean);
  if (parts[0] === bucket) parts.shift();
  return { bucket, prefix: parts.join("/") };
}

function decodePhoto(encoded: string, contentType: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new HttpError(400, "Photo data must be valid base64.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > PHOTO_MAX_BYTES) {
    throw new HttpError(413, "Photo must be no larger than 2 MB.");
  }
  const canonical = bytes.toString("base64").replace(/=+$/, "");
  if (canonical !== encoded.replace(/=+$/, "")) {
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
  if (rateBuckets.size > 2_000 && !rateBuckets.has(ip)) {
    const oldest = rateBuckets.keys().next().value;
    if (oldest) rateBuckets.delete(oldest);
  }
  const attempts = rateBuckets.get(ip) ?? [];
  if (attempts.length >= RATE_LIMIT) throw new HttpError(429, "Report submission limit reached. Please try again later.");
  attempts.push(now);
  rateBuckets.set(ip, attempts);
}

async function seedInitialReportsIdempotently(): Promise<void> {
  const now = Date.now();
  const seed = [
    ["OR-2481", "Illegal dumping", "Several bags and loose debris beside the trail entrance.", 9, "Assigned", "Downtown San Jose", 49, 42, 7, westCleanTeam],
    ["OR-2478", "Poor lighting", "The pedestrian crossing near the stop is very dark after sunset.", 7, "Under Review", "Japantown", 37, 29, 18, null],
    ["OR-2474", "Damaged sidewalks", "Raised pavement near the school crossing could be a trip hazard.", 6, "Submitted", "Willow Glen", 31, 70, 29, null],
    ["OR-2469", "Blight", "Litter around the park entrance has now been cleared.", 3, "Resolved", "Alum Rock", 78, 26, 75, "Parks Response Team"],
    ["OR-2463", "Unsafe bus stops", "The sidewalk at the northbound stop is cracked and difficult to navigate.", 6, "Assigned", "East San Jose", 76, 60, 49, westCleanTeam],
    ["OR-2459", "Other concerns", "A recycling bin is overflowing at the transit plaza.", 4, "Submitted", "Santa Clara", 18, 47, 92, null],
  ] as const;
  const values = seed.map(([id, category, description, severity, status, location, x, y, hoursAgo, assignedTeam]) => {
    const analysis = analyze(description, category);
    return {
      id,
      category,
      summary: description,
      description,
      severity,
      status,
      location,
      x,
      y,
      submittedAt: new Date(now - hoursAgo * 3_600_000),
      recommendedDepartment: analysis.recommendedDepartment,
      priority: severity >= 8 ? "High" : severity >= 5 ? "Medium" : "Low",
      assignedTeam,
      awardedPoints: status === "Resolved",
    };
  });
  await db.insert(communityReportsTable).values(values).onConflictDoNothing();
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
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    throw new HttpError(401, "A valid bearer session is required.");
  }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new HttpError(401, "A valid bearer session is required.");
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
    if ((claims.role !== "manager" && claims.role !== "worker") || !claims.sub || claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error("invalid");
    }
    return claims;
  } catch {
    throw new HttpError(401, "A valid bearer session is required.");
  }
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
    await seedInitialReportsIdempotently();
    const rows = await db.select().from(communityReportsTable).orderBy(desc(communityReportsTable.submittedAt));
    res.json(ListReportsResponse.parse(rows.map(reportResponse)));
  } catch (error) {
    req.log.error({ err: error instanceof Error ? error.message : "unknown" }, "Community reports list failed");
    errorResponse(error, res);
  }
});

router.post("/reports", async (req, res): Promise<void> => {
  let uploadedKey: string | undefined;
  try {
    enforceCreateRateLimit(req.ip || req.socket.remoteAddress || "unknown");
    const parsed = CreateReportBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid community report input.");
    const { description: rawDescription, location: locationName, category, photoBase64, contentType } = parsed.data;
    const description = rawDescription.trim();
    if (description.length < 12) throw new HttpError(400, "Description must contain at least 12 non-whitespace characters.");
    if ((photoBase64 == null) !== (contentType == null)) {
      throw new HttpError(400, "Provide both photoBase64 and contentType when attaching a photo.");
    }
    const location = locations.find((item) => item.name === locationName);
    if (!location) throw new HttpError(400, "Location is not supported.");
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
    const [created] = await db.insert(communityReportsTable).values({
      id,
      category: analysis.category,
      summary: description.slice(0, 105),
      description,
      severity: analysis.severity,
      status: "Submitted",
      location: location.name,
      x: location.x,
      y: location.y,
      photoObjectKey,
      photoContentType,
      recommendedDepartment: analysis.recommendedDepartment,
      priority: analysis.priority,
    }).returning();
    res.status(201).json(CreateReportResponse.parse(reportResponse(created)));
  } catch (error) {
    if (uploadedKey) {
      try {
        const { bucket } = storageLocation();
        await storage.bucket(bucket).file(uploadedKey).delete();
      } catch {
        req.log.warn("Could not remove an uploaded photo after report creation failed");
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
    res.status(503).json({ error: "Manager and worker sessions are not configured." });
    return;
  }
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
  const accessToken = createToken({
    role: parsed.data.role,
    sub: parsed.data.role === "manager" ? "Avery Patel" : "Luis Rivera",
    exp: Math.floor(expiresAt.getTime() / 1000),
  }, secret);
  res.json(CreateReportSessionResponse.parse({
    accessToken,
    tokenType: "Bearer",
    expiresAt,
    role: parsed.data.role,
  }));
});

router.patch("/reports/:id", async (req, res): Promise<void> => {
  try {
    const params = UpdateReportParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Invalid report ID.");
    const claims = authenticate(req);
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      throw new HttpError(400, "Provide a valid report update.");
    }
    const allowedKeys = new Set(["description", "category", "severity", "location", "status", "assignedTeam"]);
    if (Object.keys(req.body).some((key) => !allowedKeys.has(key))) {
      throw new HttpError(400, "Report update contains unsupported fields.");
    }
    const parsed = UpdateReportBody.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      throw new HttpError(400, "Provide at least one valid report update.");
    }
    if (claims.role === "worker" && (Object.keys(parsed.data).some((key) => key !== "status") || !parsed.data.status)) {
      throw new HttpError(403, "Workers may update only report status.");
    }
    const [current] = await db.select().from(communityReportsTable)
      .where(eq(communityReportsTable.id, params.data.id)).limit(1);
    if (!current) throw new HttpError(404, "Report not found.");
    if (claims.role === "worker" && current.assignedTeam !== westCleanTeam) {
      throw new HttpError(403, "Workers may update reports assigned to the West Clean Team.");
    }
    const update = parsed.data;
    const changes: Partial<typeof communityReportsTable.$inferInsert> = {};
    if (update.description !== undefined) {
      changes.description = update.description.trim();
      changes.summary = update.description.trim().slice(0, 105);
    }
    if (update.category !== undefined) changes.category = update.category;
    if (update.severity !== undefined) changes.severity = update.severity;
    if (update.location !== undefined) {
      const location = locations.find((item) => item.name === update.location);
      if (!location) throw new HttpError(400, "Location is not supported.");
      changes.location = location.name;
      changes.x = location.x;
      changes.y = location.y;
    }
    if (update.status !== undefined) changes.status = update.status;
    if (update.assignedTeam !== undefined) changes.assignedTeam = update.assignedTeam;
    if (update.category !== undefined) {
      changes.recommendedDepartment = update.category === "Poor lighting" || update.category === "Unsafe bus stops"
        ? "Transportation & Public Works"
        : update.category === "Damaged sidewalks" ? "Public Works" : "Environmental Services";
    }
    if (update.severity !== undefined) {
      changes.priority = update.severity >= 8 ? "High" : update.severity >= 5 ? "Medium" : "Low";
    }
    const newlyAwarded = update.status === "Resolved" && current.status !== "Resolved" && !current.awardedPoints;
    if (newlyAwarded) changes.awardedPoints = true;
    const [updated] = await db.update(communityReportsTable).set(changes)
      .where(and(
        eq(communityReportsTable.id, params.data.id),
        ...(newlyAwarded ? [eq(communityReportsTable.awardedPoints, false)] : []),
      ))
      .returning();
    const [latest] = updated ? [updated] : await db.select().from(communityReportsTable)
      .where(eq(communityReportsTable.id, params.data.id)).limit(1);
    if (!latest) throw new HttpError(404, "Report not found.");
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

router.get("/reports/:id/photo", async (req, res): Promise<void> => {
  try {
    const params = GetReportPhotoParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Invalid report ID.");
    const [report] = await db.select({
      photoObjectKey: communityReportsTable.photoObjectKey,
      photoContentType: communityReportsTable.photoContentType,
    }).from(communityReportsTable).where(eq(communityReportsTable.id, params.data.id)).limit(1);
    if (!report?.photoObjectKey || !report.photoContentType || !["image/jpeg", "image/png", "image/webp"].includes(report.photoContentType)) {
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