import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, familyChildrenTable } from "@workspace/db";
import {
  SendSosChatBody,
  SendSosChatResponse,
  SendSosVoiceChunkBody,
  SendSosVoiceChunkResponse,
  SummarizeSosVoiceBody,
  SummarizeSosVoiceResponse,
} from "@workspace/api-zod";
import { authenticate, HttpError } from "../lib/report-session";
import {
  replyToSos,
  replyToSosVoice,
  sosUnavailableReply,
  summarizeSosVoiceNotes,
  transcribeSosAudio,
} from "../lib/openai-assistance";

const router: IRouter = Router();
const SOS_RATE_WINDOW_MS = 15 * 60_000;
const SOS_RATE_LIMIT = 12;
const rateBuckets = new Map<string, number[]>();
const voiceRateBuckets = new Map<string, number[]>();

function enforceSosRateLimit(subject: string): void {
  const now = Date.now();
  const active = (rateBuckets.get(subject) ?? []).filter((time) => time > now - SOS_RATE_WINDOW_MS);
  if (active.length >= SOS_RATE_LIMIT) throw new HttpError(429, "SOS chat message limit reached. Keep using the safety steps on screen.");
  active.push(now);
  rateBuckets.set(subject, active);
}

function enforceVoiceRateLimit(subject: string): void {
  const now = Date.now();
  const active = (voiceRateBuckets.get(subject) ?? []).filter((time) => time > now - SOS_RATE_WINDOW_MS);
  if (active.length >= 8) throw new HttpError(429, "SOS voice limit reached. Keep using the safety steps on screen.");
  active.push(now);
  voiceRateBuckets.set(subject, active);
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

router.post("/sos/voice-chunk", async (req, res): Promise<void> => {
  let audioBuffer: Buffer | undefined;
  let wavBuffer: Buffer | undefined;
  let transcript = "";
  try {
    const claims = authenticate(req);
    await assertApprovedChild(claims);
    const parsed = SendSosVoiceChunkBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid SOS voice input.");
    enforceVoiceRateLimit(claims.sub);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(parsed.data.audioBase64)) {
      throw new HttpError(400, "Invalid SOS voice audio.");
    }
    audioBuffer = Buffer.from(parsed.data.audioBase64, "base64");
    if (audioBuffer.length === 0 || audioBuffer.length > 1_000_000) {
      throw new HttpError(400, "SOS voice clips must be short. Record a new brief clip.");
    }

    try {
      const transcription = await transcribeSosAudio(audioBuffer);
      transcript = transcription.transcript;
      wavBuffer = transcription.wavBuffer;
      const response = await replyToSosVoice({
        wavBuffer,
        transcript,
        messages: parsed.data.messages,
        spokenReplies: parsed.data.spokenReplies,
      });
      res.json(SendSosVoiceChunkResponse.parse({
        transcript,
        reply: response.reply,
        available: true,
        audioBase64: response.audioBase64,
        audioContentType: response.audioBase64 ? "audio/mpeg" : null,
      }));
    } catch (error) {
      req.log.warn({
        errorType: error instanceof Error ? error.name : "unknown",
      }, "SOS voice AI unavailable; returning safety fallback");
      res.json(SendSosVoiceChunkResponse.parse({
        transcript,
        reply: sosUnavailableReply,
        available: false,
        audioBase64: null,
        audioContentType: null,
      }));
    }
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 429) res.setHeader("Retry-After", "900");
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error instanceof Error ? error.name : "unknown" }, "SOS voice request failed");
    res.status(500).json({ error: "SOS voice chat could not be completed." });
  } finally {
    audioBuffer?.fill(0);
    wavBuffer?.fill(0);
  }
});

router.post("/sos/voice-summary", async (req, res): Promise<void> => {
  try {
    const claims = authenticate(req);
    await assertApprovedChild(claims);
    const parsed = SummarizeSosVoiceBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid SOS voice summary input.");
    enforceSosRateLimit(`${claims.sub}:voice-summary`);
    const result = await summarizeSosVoiceNotes(parsed.data.messages.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })));
    res.json(SummarizeSosVoiceResponse.parse(result));
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 429) res.setHeader("Retry-After", "900");
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.warn({
      errorType: error instanceof Error ? error.name : "unknown",
    }, "SOS voice summary unavailable");
    res.status(503).json({ error: "The transcript summary is unavailable. The reviewed transcript is still available." });
  }
});

export default router;