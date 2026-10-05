import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, familyChildrenTable } from "@workspace/db";
import { SendSosChatBody, SendSosChatResponse } from "@workspace/api-zod";
import { authenticate, HttpError } from "../lib/report-session";
import { replyToSos, sosUnavailableReply } from "../lib/openai-assistance";

const router: IRouter = Router();
const SOS_RATE_WINDOW_MS = 15 * 60_000;
const SOS_RATE_LIMIT = 12;
const rateBuckets = new Map<string, number[]>();

function enforceSosRateLimit(subject: string): void {
  const now = Date.now();
  const active = (rateBuckets.get(subject) ?? []).filter((time) => time > now - SOS_RATE_WINDOW_MS);
  if (active.length >= SOS_RATE_LIMIT) throw new HttpError(429, "SOS chat message limit reached. Keep using the safety steps on screen.");
  active.push(now);
  rateBuckets.set(subject, active);
}

async function assertApprovedChild(claims: ReturnType<typeof authenticate>): Promise<void> {
  if (claims.role !== "child") throw new HttpError(403, "The SOS chat is available only to an approved child role.");
  if (claims.familyChildId) {
    const [child] = await db.select({ id: familyChildrenTable.id })
      .from(familyChildrenTable)
      .where(and(
        eq(familyChildrenTable.id, claims.familyChildId),
        eq(familyChildrenTable.approvalStatus, "approved"),
      ))
      .limit(1);
    if (!child) throw new HttpError(403, "A parent must approve this child before SOS chat is available.");
    return;
  }
  const [pending] = await db.select({ id: familyChildrenTable.id })
    .from(familyChildrenTable)
    .where(eq(familyChildrenTable.approvalStatus, "pending"))
    .limit(1);
  if (pending) throw new HttpError(403, "A parent must approve the family request before SOS chat is available.");
}

router.post("/sos/chat", async (req, res): Promise<void> => {
  try {
    const claims = authenticate(req);
    await assertApprovedChild(claims);
    const parsed = SendSosChatBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid SOS chat context.");
    enforceSosRateLimit(claims.sub);
    try {
      const result = await replyToSos(parsed.data.messages);
      res.json(SendSosChatResponse.parse(result));
    } catch (error) {
      req.log.warn({
        errorType: error instanceof Error ? error.name : "unknown",
      }, "SOS AI reply unavailable; returning safety fallback");
      res.json(SendSosChatResponse.parse({ reply: sosUnavailableReply, available: false }));
    }
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 429) res.setHeader("Retry-After", "900");
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error instanceof Error ? error.name : "unknown" }, "SOS chat request failed");
    res.status(500).json({ error: "SOS chat could not be completed." });
  }
});

export default router;