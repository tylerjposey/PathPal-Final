import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { findVtaJourneys, getVtaGtfs, scheduledTimestamp, type Feed, type GtfsJourney, type GtfsStop } from "./vta-gtfs";
import { parseHeatPoints, renderGoogle3DMap } from "./google-3d-map";
import {
  GetJourneyCatalogQueryParams,
  GetJourneyCatalogResponse,
  GetJourneyMapImageQueryParams,
  GetJourneyMapQueryParams,
  GetJourneyMapResponse,
  GetJourneyOptionsQueryParams,
  GetJourneyOptionsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const API_511_BASE = "https://api.511.org/transit";
const GOOGLE_COMPUTE_ROUTES_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const GOOGLE_STATIC_MAP_URL =
  "https://maps.googleapis.com/maps/api/staticmap";
const UPSTREAM_TIMEOUT_MS = 8_000;
const CATALOG_TTL_MS = 15 * 60_000;
const STOP_MONITORING_TTL_MS = 60_000;
const STOP_MONITORING_FAILURE_TTL_MS = 30_000;
const MAP_IMAGE_TTL_MS = 5 * 60_000;
const MAP_SPEC_TTL_MS = 10 * 60_000;
const MAX_MAP_SPEC_CACHE_ENTRIES = 256;
const MAP_IMAGE_RATE_WINDOW_MS = 60_000;
const MAP_IMAGE_RATE_LIMIT = 8;
const MAX_MAP_IMAGE_CACHE_ENTRIES = 128;
const MAX_511_REQUESTS_PER_HOUR = 55;
const GOOGLE_ROUTES_TTL_MS = 3 * 60_000;
const VTA_AGENCY_PATTERN =
  /\bVTA\b|Santa Clara Valley Transportation Authority|Valley Transportation Authority/i;
const LEG_COLORS = {
  walk: "0x64748BFF",
  bus: ["0x1565C0FF", "0x2E7D32FF", "0xEF6C00FF", "0x8E24AAFF", "0xC62828FF"],
} as const;

type JourneyStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distanceMeters?: number;
};

type JourneyLeg = {
  type: "walk" | "bus";
  routeNumber: string | null;
  routeName: string | null;
  boardingStop: JourneyStop;
  alightingStop: JourneyStop;
  distanceMeters: number;
  durationMinutes: number;
  delayMinutes: number | null;
  predictedArrival: string | null;
  transferGuidance: string | null;
  polyline: string | null;
};

type JourneyRoute = {
  id: string;
  name: string;
  startStop: string;
  destinationStop: string;
  durationMinutes: number;
  walkingMeters: number;
  transfers: number;
  delayMinutes: number;
  alerts: string[];
  available: boolean;
  recommended: boolean;
  source: "live" | "demo";
  polyline?: string | null;
  mode: "walking" | "transit";
  legs: JourneyLeg[];
};

type BoardingStop = {
  id?: string;
  name: string;
  lat?: number;
  lng?: number;
};

type LegStop = {
  type: "walk" | "bus";
  boarding: BoardingStop;
  alighting: BoardingStop;
  distanceMeters: number;
  durationMinutes: number;
  polyline: string | null;
  routeNumber: string | null;
  routeName: string | null;
  scheduledDeparture: number | undefined;
  vehicleType?: string | null;
  agencyNames?: string[];
};

type ParsedGoogleRoute = {
  route: JourneyRoute;
  lineRefs: string[];
  boardingStop?: BoardingStop;
  legStops: LegStop[];
};

type TravelMode = "any" | "walking" | "transit";

type MapSpec = {
  lat: number;
  lng: number;
  paths: { encoded: string; color: string }[];
  markers: { lat: number; lng: number; color: string; label?: string }[];
};

type TransitCatalog = {
  routes: string[];
  stops: JourneyStop[];
  lines: TransitLine[];
  alerts: TransitAlert[];
  operatorId: string;
  agency: string;
  complete: boolean;
  message?: string;
};

type TransitLine = { id: string; name: string; refs: string[] };
type TransitAlert = { text: string; lineRefs: string[] };
type StopPrediction = { lineRef: string; delayMinutes: number };
const lineLabel = (line: TransitLine): string => {
  const code = line.refs.find((ref) => /^\d{1,4}[A-Z]?$/.test(ref));
  return code && !line.name.toLowerCase().includes(code.toLowerCase())
    ? `${code} · ${line.name}`
    : line.name;
};
type CacheEntry<T> = { expiresAt: number; value: T };
let catalogCache: CacheEntry<TransitCatalog> | undefined;
let catalogInFlight: Promise<TransitCatalog | undefined> | undefined;
const monitoringCache = new Map<string, CacheEntry<StopPrediction[]>>();
let catalogFailureExpiresAt = 0;
const monitoringFailureExpiresAt = new Map<string, number>();
const api511RequestTimes: number[] = [];
const mapImageCache = new Map<
  string,
  CacheEntry<{ buffer: Buffer; contentType: string }>
>();
const mapImageRequestsByIp = new Map<string, number[]>();
const mapSpecCache = new Map<string, CacheEntry<MapSpec>>();
type GoogleRoutesResult = {
  walkingRoute: ParsedGoogleRoute | undefined;
};
const googleRoutesCache = new Map<string, CacheEntry<GoogleRoutesResult>>();
const googleRoutesInFlight = new Map<string, Promise<GoogleRoutesResult>>();

function storeMapSpec(spec: MapSpec): string {
  const now = Date.now();
  for (const [key, entry] of mapSpecCache) {
    if (entry.expiresAt <= now) mapSpecCache.delete(key);
  }
  while (mapSpecCache.size >= MAX_MAP_SPEC_CACHE_ENTRIES) {
    const oldestKey = mapSpecCache.keys().next().value;
    if (!oldestKey) break;
    mapSpecCache.delete(oldestKey);
  }
  const token = randomUUID();
  mapSpecCache.set(token, { value: spec, expiresAt: now + MAP_SPEC_TTL_MS });
  return token;
}

function getMapSpec(token: string): MapSpec | undefined {
  const cached = mapSpecCache.get(token);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    mapSpecCache.delete(token);
    return undefined;
  }
  return cached.value;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function getPath(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    const record = asRecord(current);
    if (!record) return undefined;
    const foundKey = Object.keys(record).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (!foundKey) return undefined;
    current = record[foundKey];
  }
  return current;
}

function objectList(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map(asRecord).filter((item): item is Record<string, unknown> => !!item);
}

function numberField(
  record: Record<string, unknown>,
  names: string[],
): number | undefined {
  const normalizedNames = names.map((name) => name.toLowerCase().replace(/[^a-z]/g, ""));
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if (normalizedNames.includes(normalizedKey)) {
      const parsed = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function safeText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 500) : undefined;
  }
  return undefined;
}

function safePolyline(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 50_000
    ? value
    : null;
}

async function fetchJson(url: URL, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    logger.warn({ provider: url.hostname === "api.511.org" ? "511" : "Google Maps", status: response.status }, "Journey upstream HTTP failure");
    throw new Error("Upstream request failed");
  }
  return (await response.json()) as unknown;
}

async function fetch511Json(url: URL, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<unknown> {
  const now = Date.now();
  while (api511RequestTimes.length && api511RequestTimes[0] <= now - 60 * 60_000) {
    api511RequestTimes.shift();
  }
  if (api511RequestTimes.length >= MAX_511_REQUESTS_PER_HOUR) {
    throw new Error("511 request budget reached");
  }
  api511RequestTimes.push(now);
  return fetchJson(url, timeoutMs);
}

function make511Url(endpoint: string, apiKey: string): URL {
  const url = new URL(`${API_511_BASE}/${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  return url;
}

function parse511Operators(payload: unknown) {
  const content = objectList(Array.isArray(payload) ? payload : asRecord(payload)?.content);
  const vta = content.find((operator) => {
    const shortName = safeText(operator.ShortName) ?? "";
    const name = safeText(operator.Name) ?? "";
    return /\bVTA\b/i.test(shortName) ||
      /Santa Clara Valley Transportation Authority|Valley Transportation Authority/i.test(name);
  });
  if (!vta) return undefined;
  const id = safeText(vta.Id);
  const agency = safeText(vta.ShortName);
  return id && agency ? { id, agency } : undefined;
}

function parse511Lines(payload: unknown): TransitLine[] {
  const content = objectList(Array.isArray(payload) ? payload : asRecord(payload)?.content);
  return content
    .map((line) => {
      const id = safeText(line.Id);
      const name = safeText(line.Name);
      if (!id || !name) return undefined;
      const refs = [
        id,
        safeText(line.PublicCode),
        safeText(line.SiriLineRef),
      ].filter((ref): ref is string => !!ref);
      return { id, name, refs: [...new Set(refs)] };
    })
    .filter((line): line is TransitLine => !!line);
}

function parse511Stops(payload: unknown): JourneyStop[] {
  const dataObjects = asRecord(getPath(payload, "Contents", "dataObjects"));
  if (!dataObjects) return [];
  return objectList(dataObjects.ScheduledStopPoint)
    .map((point) => {
      const id = safeText(point.id);
      const name = safeText(point.Name);
      const location = asRecord(point.Location);
      const lat = location ? numberField(location, ["latitude"]) : undefined;
      const lng = location ? numberField(location, ["longitude"]) : undefined;
      if (
        !id ||
        !name ||
        lat === undefined ||
        lng === undefined ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return undefined;
      }
      return { id, name, lat, lng };
    })
    .filter((stop): stop is JourneyStop => !!stop);
}

function lineRefsIn(value: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    for (const [key, child] of Object.entries(record)) {
      if (key.toLowerCase() === "lineref") {
        const ref =
          typeof child === "string"
            ? child.trim()
            : safeText(asRecord(child)?.ref);
        if (ref) found.push(ref);
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return [...new Set(found)];
}

function parse511Alerts(payload: unknown): { valid: boolean; alerts: TransitAlert[] } {
  const gtfs = asRecord(payload);
  if (gtfs && Array.isArray(gtfs.Entities)) {
    const translatedText = (value: unknown): string | undefined => {
      const translations = objectList(getPath(value, "Translations"));
      return translations.map((entry) => safeText(getPath(entry, "Text"))).find((text) => !!text);
    };
    const alerts = objectList(gtfs.Entities)
      .map((entity) => {
        const alert = asRecord(getPath(entity, "Alert"));
        if (!alert) return undefined;
        const periods = objectList(getPath(alert, "ActivePeriods"));
        const now = Date.now() / 1000;
        if (periods.length && !periods.some((period) => {
          const start = numberField(period, ["start"]);
          const end = numberField(period, ["end"]);
          return (start === undefined || start <= now) && (end === undefined || end >= now);
        })) return undefined;
        const text = translatedText(getPath(alert, "HeaderText")) ??
          translatedText(getPath(alert, "DescriptionText"));
        if (!text) return undefined;
        const lineRefs = objectList(getPath(alert, "InformedEntities"))
          .flatMap((informed) => [
            safeText(getPath(informed, "RouteId")),
            safeText(getPath(informed, "Trip", "RouteId")),
          ].filter((ref): ref is string => !!ref));
        return { text, lineRefs: [...new Set(lineRefs)] };
      })
      .filter((alert): alert is TransitAlert => !!alert)
      .slice(0, 30);
    return { valid: true, alerts };
  }
  const situationExchange = getPath(
    payload,
    "Siri",
    "ServiceDelivery",
    "SituationExchangeDelivery",
  );
  const exchange = asRecord(situationExchange);
  if (!exchange) return { valid: false, alerts: [] };
  const situations = asRecord(exchange.Situations);
  if (!situations) return { valid: true, alerts: [] };
  const alerts = objectList(situations.PtSituationElement)
    .map((situation) => {
      const text =
        safeText(situation.Summary) ??
        safeText(situation.Description);
      if (!text) return undefined;
      return { text, lineRefs: lineRefsIn(situation) };
    })
    .filter((alert): alert is TransitAlert => !!alert)
    .slice(0, 30);
  return { valid: true, alerts };
}

async function get511Catalog(): Promise<TransitCatalog | undefined> {
  const apiKey = process.env.TRANSIT_511_API_KEY;
  if (!apiKey) return undefined;
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.value;
  }
  if (catalogFailureExpiresAt > Date.now()) return undefined;
  if (catalogInFlight) return catalogInFlight;

  catalogInFlight = (async () => {
    try {
      // This is intentionally the first 511 API call: operator discovery is lazy.
      const operatorsPayload = await fetch511Json(make511Url("operators", apiKey));
      const operator = parse511Operators(operatorsPayload);
      if (!operator) {
        const shape = asRecord(operatorsPayload);
        logger.warn({
          provider: "511",
          payloadType: Array.isArray(operatorsPayload) ? "array" : typeof operatorsPayload,
          topLevelFields: Object.keys(shape ?? {}).slice(0, 8),
          operatorCount: objectList(Array.isArray(operatorsPayload) ? operatorsPayload : shape?.content).length,
          firstOperatorFields: Object.keys(objectList(Array.isArray(operatorsPayload) ? operatorsPayload : shape?.content)[0] ?? {}).slice(0, 8),
          providerCode: typeof shape?.code === "number" ? shape.code : undefined,
        }, "VTA operator unavailable in 511 response");
        throw new Error("VTA operator unavailable");
      }

      const fetchFeed = async (
        endpoint: string,
      ): Promise<{ payload?: unknown; ok: boolean }> => {
        const url = make511Url(endpoint, apiKey);
        url.searchParams.set("operator_id", operator.id);
        try {
          return { payload: await fetch511Json(url, endpoint === "stops" ? 20_000 : UPSTREAM_TIMEOUT_MS), ok: true };
        } catch {
          return { ok: false };
        }
      };

      const alertsUrl = make511Url("servicealerts", apiKey);
      alertsUrl.searchParams.set("agency", operator.id);
      const [linesResult, stopsResult, alertsResult] = await Promise.all([
        fetchFeed("lines"),
        fetchFeed("stops"),
        (async () => {
          try {
            return { payload: await fetch511Json(alertsUrl), ok: true };
          } catch {
            return { ok: false };
          }
        })(),
      ]);
      const parsedAlerts = alertsResult.ok
        ? parse511Alerts(alertsResult.payload)
        : { valid: false, alerts: [] };
      const lines = linesResult.ok ? parse511Lines(linesResult.payload) : [];
      const stops = stopsResult.ok ? parse511Stops(stopsResult.payload) : [];
      const complete =
        linesResult.ok &&
        stopsResult.ok &&
        parsedAlerts.valid &&
        lines.length > 0 &&
        stops.length > 0;
      if (!complete) {
        const alertShape = asRecord(alertsResult.payload);
        const siri = asRecord(alertShape?.Siri);
        const delivery = asRecord(siri?.ServiceDelivery);
        logger.warn({
          provider: "511",
          linesFeedOk: linesResult.ok,
          stopsFeedOk: stopsResult.ok,
          alertsFeedOk: alertsResult.ok,
          alertsParsed: parsedAlerts.valid,
          lineCount: lines.length,
          stopCount: stops.length,
          alertPayloadType: Array.isArray(alertsResult.payload) ? "array" : typeof alertsResult.payload,
          alertFields: Object.keys(alertShape ?? {}).slice(0, 8),
          siriFields: Object.keys(siri ?? {}).slice(0, 8),
          deliveryFields: Object.keys(delivery ?? {}).slice(0, 8),
          alertArrayLength: Array.isArray(alertsResult.payload) ? alertsResult.payload.length : undefined,
        }, "VTA catalog incomplete");
      }
      const catalog: TransitCatalog = {
        operatorId: operator.id,
        agency: operator.id,
        routes: [...new Set(lines.map(lineLabel))],
        lines,
        stops,
        alerts: parsedAlerts.alerts,
        complete,
        ...(!complete
          ? { message: "VTA catalog feeds are incomplete; no live catalog is available." }
          : {}),
      };
      catalogCache = { value: catalog, expiresAt: Date.now() + CATALOG_TTL_MS };
      catalogFailureExpiresAt = complete ? 0 : catalogCache.expiresAt;
      return catalog;
    } catch {
      // Never attach upstream URLs or provider error text; they can contain credentials.
      catalogFailureExpiresAt = Date.now() + 60_000;
      return undefined;
    } finally {
      catalogInFlight = undefined;
    }
  })();
  return catalogInFlight;
}

async function getStopMonitoringAlerts(
  apiKey: string | undefined,
  agency: string | undefined,
  stopId: string | undefined,
): Promise<StopPrediction[]> {
  if (!apiKey || !agency || !stopId) return [];
  const cacheKey = `${agency}:${stopId}`;
  const cached = monitoringCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if ((monitoringFailureExpiresAt.get(cacheKey) ?? 0) > Date.now()) return [];
  try {
    const url = make511Url("StopMonitoring", apiKey);
    url.searchParams.set("agency", agency);
    url.searchParams.set("stopCode", stopId);
    const payload = await fetch511Json(url);
    const visits = getPath(
      payload,
      "Siri",
      "ServiceDelivery",
      "StopMonitoringDelivery",
      "MonitoredStopVisit",
    );
    const predictions = objectList(visits)
      .map((visit) => {
        const journey = asRecord(visit.MonitoredVehicleJourney);
        const call = asRecord(journey?.MonitoredCall);
        if (!journey || !call) return undefined;
        const lineRef = safeText(journey.LineRef);
        const departureAimed = safeText(call.AimedDepartureTime);
        const departureExpected = safeText(call.ExpectedDepartureTime);
        const arrivalAimed = safeText(call.AimedArrivalTime);
        const arrivalExpected = safeText(call.ExpectedArrivalTime);
        const aimed =
          departureAimed && departureExpected ? departureAimed : arrivalAimed;
        const expected =
          departureAimed && departureExpected ? departureExpected : arrivalExpected;
        if (!lineRef || !aimed || !expected) return undefined;
        const aimedTime = Date.parse(aimed);
        const expectedTime = Date.parse(expected);
        if (!Number.isFinite(aimedTime) || !Number.isFinite(expectedTime)) {
          return undefined;
        }
        return {
          lineRef,
          delayMinutes: Math.max(
            0,
            Math.ceil((expectedTime - aimedTime) / 60_000),
          ),
        };
      })
      .filter((prediction): prediction is StopPrediction => !!prediction);
    monitoringCache.set(cacheKey, {
      value: predictions,
      expiresAt: Date.now() + STOP_MONITORING_TTL_MS,
    });
    for (const [key, entry] of monitoringCache) {
      if (entry.expiresAt <= Date.now()) monitoringCache.delete(key);
    }
    while (monitoringCache.size > 128) {
      const oldestKey = monitoringCache.keys().next().value;
      if (!oldestKey) break;
      monitoringCache.delete(oldestKey);
    }
    monitoringFailureExpiresAt.delete(cacheKey);
    return predictions;
  } catch {
    monitoringFailureExpiresAt.set(
      cacheKey,
      Date.now() + STOP_MONITORING_FAILURE_TTL_MS,
    );
    for (const [key, expiry] of monitoringFailureExpiresAt) {
      if (expiry <= Date.now()) monitoringFailureExpiresAt.delete(key);
    }
    while (monitoringFailureExpiresAt.size > 128) {
      const oldestKey = monitoringFailureExpiresAt.keys().next().value;
      if (!oldestKey) break;
      monitoringFailureExpiresAt.delete(oldestKey);
    }
    return [];
  }
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(aLat)) *
      Math.cos(radians(bLat)) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function rankJourneyRoutes<T extends JourneyRoute>(routes: T[]): T[] {
  const score = (route: T) =>
    (route.available ? 0 : 1_000_000) +
    route.durationMinutes +
    route.transfers * 7 +
    route.walkingMeters * 0.01 +
    route.delayMinutes * 2 +
    route.alerts.length * 5;
  return routes
    .map((route) => ({ ...route, recommended: false }))
    .sort((a, b) => score(a) - score(b))
    .map((route, index) => ({ ...route, recommended: index === 0 && route.available }));
}

function stopFromRoutesApiLocation(
  raw: Record<string, unknown> | undefined,
  fallbackName: string,
  fallbackLat: number,
  fallbackLng: number,
): BoardingStop {
  const location = asRecord(getPath(raw ?? {}, "location", "latLng"));
  const lat = location ? numberField(location, ["latitude"]) : undefined;
  const lng = location ? numberField(location, ["longitude"]) : undefined;
  return {
    name: safeText(raw?.name) ?? fallbackName,
    lat: lat ?? fallbackLat,
    lng: lng ?? fallbackLng,
  };
}

function parseGoogleRoute(
  route: Record<string, unknown>,
  index: number,
): ParsedGoogleRoute | undefined {
  const legs = Array.isArray(route.legs) ? route.legs : [];
  if (!legs.length) return undefined;
  let walkingMeters = 0;
  const durationText = safeText(route.duration) ?? "";
  const durationSeconds = Number(durationText.replace(/s$/, "")) || 0;
  let transitBoardings = 0;
  const lineNames: string[] = [];
  const lineRefs: string[] = [];
  let startStop: string | undefined;
  let destinationStop: string | undefined;
  let boardingStop: BoardingStop | undefined;
  const legStops: LegStop[] = [];
  for (const legValue of legs) {
    const leg = asRecord(legValue);
    if (!leg) continue;
    const steps = Array.isArray(leg.steps) ? leg.steps : [];
    for (const stepValue of steps) {
      const step = asRecord(stepValue);
      if (!step) continue;
      const mode = safeText(step.travelMode);
      const stepStart = asRecord(getPath(step, "startLocation", "latLng"));
      const stepEnd = asRecord(getPath(step, "endLocation", "latLng"));
      const stepStartLat = stepStart ? numberField(stepStart, ["latitude"]) : undefined;
      const stepStartLng = stepStart ? numberField(stepStart, ["longitude"]) : undefined;
      const stepEndLat = stepEnd ? numberField(stepEnd, ["latitude"]) : undefined;
      const stepEndLng = stepEnd ? numberField(stepEnd, ["longitude"]) : undefined;
      const stepPolyline = safePolyline(asRecord(step.polyline)?.encodedPolyline);
      const stepDistanceMeters = Math.round(numberField(step, ["distanceMeters"]) ?? 0);
      const stepStaticDuration = safeText(step.staticDuration) ?? "";
      const stepDurationMinutes = Math.max(
        0,
        Math.ceil((Number(stepStaticDuration.replace(/s$/, "")) || 0) / 60),
      );
      if (mode === "WALK") {
        walkingMeters += stepDistanceMeters;
        if (
          stepStartLat !== undefined &&
          stepStartLng !== undefined &&
          stepEndLat !== undefined &&
          stepEndLng !== undefined
        ) {
          legStops.push({
            type: "walk",
            boarding: { name: "Walking start", lat: stepStartLat, lng: stepStartLng },
            alighting: { name: "Walking end", lat: stepEndLat, lng: stepEndLng },
            distanceMeters: stepDistanceMeters,
            durationMinutes: stepDurationMinutes,
            polyline: stepPolyline,
            routeNumber: null,
            routeName: null,
            scheduledDeparture: undefined,
          });
        }
      }
      if (mode !== "TRANSIT") continue;
      const details = asRecord(step.transitDetails);
      if (!details) continue;
      const stopDetails = asRecord(details.stopDetails);
      const departure = asRecord(stopDetails?.departureStop);
      const arrival = asRecord(stopDetails?.arrivalStop);
      transitBoardings += 1;
      startStop ??= safeText(departure?.name);
      destinationStop = safeText(arrival?.name) ?? destinationStop;
      const departureBoarding = stopFromRoutesApiLocation(
        departure,
        "Boarding stop",
        stepStartLat ?? 0,
        stepStartLng ?? 0,
      );
      const arrivalAlighting = stopFromRoutesApiLocation(
        arrival,
        "Alighting stop",
        stepEndLat ?? 0,
        stepEndLng ?? 0,
      );
      if (!boardingStop) boardingStop = departureBoarding;
      const line = asRecord(details.transitLine);
      const shortName = safeText(line?.nameShort);
      const fullName = safeText(line?.name);
      for (const lineName of [shortName, fullName]) {
        if (lineName && !lineNames.includes(lineName)) lineNames.push(lineName);
        if (lineName && !lineRefs.includes(lineName)) lineRefs.push(lineName);
      }
      const vehicleType = safeText(getPath(line ?? {}, "vehicle", "type")) ?? null;
      const agencyNames = objectList(line?.agencies)
        .map((agency) => safeText(agency.name))
        .filter((name): name is string => !!name);
      const departureTimeText = safeText(stopDetails?.departureTime);
      const departureTimeMs = departureTimeText ? Date.parse(departureTimeText) : NaN;
      legStops.push({
        type: "bus",
        boarding: departureBoarding,
        alighting: arrivalAlighting,
        distanceMeters: stepDistanceMeters,
        durationMinutes: stepDurationMinutes,
        polyline: stepPolyline,
        routeNumber: shortName ?? null,
        routeName: fullName ?? shortName ?? null,
        scheduledDeparture: Number.isFinite(departureTimeMs) ? departureTimeMs / 1000 : undefined,
        vehicleType,
        agencyNames,
      });
    }
  }
  const encodedPolyline = safePolyline(asRecord(route.polyline)?.encodedPolyline);
  const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
  const routeName = lineNames.length ? lineNames.join(" → ") : `Transit option ${index + 1}`;
  const journeyRoute: JourneyRoute = {
    id: `google-route-${index + 1}`,
    name: routeName,
    startStop: startStop ?? "Starting location",
    destinationStop: destinationStop ?? "Destination",
    durationMinutes,
    walkingMeters: Math.round(walkingMeters),
    transfers: Math.max(0, transitBoardings - 1),
    delayMinutes: 0,
    alerts: [],
    available: true,
    recommended: false,
    source: "live",
    mode: "transit",
    legs: [],
    ...(encodedPolyline ? { polyline: encodedPolyline } : {}),
  };
  return {
    route: journeyRoute,
    lineRefs,
    ...(boardingStop ? { boardingStop } : {}),
    legStops,
  };
}

async function fetchGoogleDirections(
  lat: number,
  lng: number,
  destination: string,
): Promise<{ routes: ParsedGoogleRoute[]; stops: JourneyStop[] } | undefined> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return undefined;
  try {
    const response = await fetch(GOOGLE_COMPUTE_ROUTES_URL, {
      method: "POST",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.travelMode,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.steps.transitDetails.stopDetails,routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.name,routes.legs.steps.transitDetails.transitLine.vehicle.type,routes.legs.steps.transitDetails.transitLine.agencies",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: lat, longitude: lng } } },
        destination: { address: destination },
        travelMode: "TRANSIT",
        computeAlternativeRoutes: true,
      }),
    });
    if (!response.ok) {
      logger.warn({ provider: "Google Maps", status: response.status }, "Journey directions unavailable");
      return undefined;
    }
    const payload = asRecord(await response.json());
    const rawRoutes = Array.isArray(payload?.routes) ? payload.routes : [];
    if (!rawRoutes.length) return undefined;
    const routes = rawRoutes
      .map((item, index) => {
        const record = asRecord(item);
        return record ? parseGoogleRoute(record, index) : undefined;
      })
      .filter((route): route is ParsedGoogleRoute => !!route);
    if (!routes.length) return undefined;

    const stopMap = new Map<string, JourneyStop>();
    for (const parsedRoute of routes) {
      for (const legStop of parsedRoute.legStops) {
        if (legStop.type !== "bus") continue;
        for (const stop of [legStop.boarding, legStop.alighting]) {
          if (
            stop.lat === undefined ||
            stop.lng === undefined ||
            Math.abs(stop.lat) > 90 ||
            Math.abs(stop.lng) > 180
          ) {
            continue;
          }
          const id = `${stop.name.toLowerCase()}-${stop.lat.toFixed(5)}-${stop.lng.toFixed(5)}`;
          stopMap.set(id, { id, name: stop.name, lat: stop.lat, lng: stop.lng });
        }
      }
    }
    return {
      routes,
      stops: [...stopMap.values()],
    };
  } catch {
    return undefined;
  }
}

function isVtaBusLeg(legStop: LegStop, catalog: TransitCatalog | undefined): boolean {
  if (legStop.type !== "bus") return true;
  if (legStop.agencyNames && legStop.agencyNames.length > 0) {
    return legStop.agencyNames.some((name) => VTA_AGENCY_PATTERN.test(name));
  }
  // Agency name wasn't returned by Google; fall back to matching the line
  // against the live VTA route/line catalog from 511.
  if (catalog?.lines.length) {
    const refs = [legStop.routeNumber, legStop.routeName]
      .filter((ref): ref is string => !!ref)
      .map(normalizedRef);
    return catalog.lines.some((line) =>
      [line.name, ...line.refs].map(normalizedRef).some((ref) => refs.includes(ref)),
    );
  }
  // Neither Google's agency field nor a live catalog is available to confirm
  // the operator; do not present an unverified route as a VTA bus journey.
  return false;
}

function filterVtaBusRoutes(
  routes: ParsedGoogleRoute[],
  catalog: TransitCatalog | undefined,
): ParsedGoogleRoute[] {
  return routes.filter((route) => {
    const hasBusLeg = route.legStops.some((legStop) => legStop.type === "bus");
    if (!hasBusLeg) return false;
    const hasNonBusVehicle = route.legStops.some(
      (legStop) =>
        legStop.type === "bus" &&
        legStop.vehicleType &&
        legStop.vehicleType.toUpperCase() !== "BUS",
    );
    if (hasNonBusVehicle) return false;
    return route.legStops.every((legStop) => isVtaBusLeg(legStop, catalog));
  });
}

async function fetchCachedGoogleRoutes(
  lat: number,
  lng: number,
  destination: string,
): Promise<GoogleRoutesResult> {
  const cacheKey = `${lat.toFixed(5)}:${lng.toFixed(5)}:${destination.trim().toLowerCase()}`;
  const now = Date.now();
  const cached = googleRoutesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  const inFlight = googleRoutesInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<GoogleRoutesResult> => {
    try {
      const walkingRoute = await fetchGoogleWalkingRoute(lat, lng, destination);
      const result: GoogleRoutesResult = { walkingRoute };
      googleRoutesCache.set(cacheKey, { value: result, expiresAt: Date.now() + GOOGLE_ROUTES_TTL_MS });
      for (const [key, entry] of googleRoutesCache) {
        if (entry.expiresAt <= Date.now()) googleRoutesCache.delete(key);
      }
      while (googleRoutesCache.size > 256) {
        const oldestKey = googleRoutesCache.keys().next().value;
        if (!oldestKey) break;
        googleRoutesCache.delete(oldestKey);
      }
      return result;
    } finally {
      googleRoutesInFlight.delete(cacheKey);
    }
  })();
  googleRoutesInFlight.set(cacheKey, request);
  return request;
}

function demoLeg(type: "walk" | "bus", boarding: JourneyStop, alighting: JourneyStop): JourneyLeg {
  return {
    type,
    routeNumber: type === "bus" ? "22" : null,
    routeName: type === "bus" ? "Demo Route 22" : null,
    boardingStop: boarding,
    alightingStop: alighting,
    distanceMeters: type === "walk" ? 350 : 0,
    durationMinutes: type === "walk" ? 6 : 24,
    delayMinutes: null,
    predictedArrival: null,
    transferGuidance: null,
    polyline: null,
  };
}

function demoJourney(
  lat: number,
  lng: number,
  destination: string,
  message: string,
  mode: TravelMode,
) {
  const stop: JourneyStop = {
    id: "demo-origin-stop",
    name: "Demo nearby stop",
    lat,
    lng,
    distanceMeters: 0,
  };
  const destinationStop: JourneyStop = {
    id: "demo-destination-stop",
    name: destination,
    lat,
    lng,
  };
  const routes: JourneyRoute[] = [];
  if (mode !== "transit") {
    const legs = [demoLeg("walk", stop, destinationStop)];
    routes.push({
      id: "demo-walking-option",
      name: "Walk the whole way",
      startStop: stop.name,
      destinationStop: destination,
      durationMinutes: 18,
      walkingMeters: 1400,
      transfers: 0,
      delayMinutes: 0,
      alerts: [],
      available: true,
      recommended: false,
      source: "demo",
      mode: "walking",
      legs,
    });
  }
  if (mode !== "walking") {
    const legs = [demoLeg("walk", stop, stop), demoLeg("bus", stop, destinationStop)];
    routes.push({
      id: "demo-transit-option",
      name: "Demo transit option",
      startStop: stop.name,
      destinationStop: destination,
      durationMinutes: 30,
      walkingMeters: 350,
      transfers: 0,
      delayMinutes: 0,
      alerts: [],
      available: true,
      recommended: false,
      source: "demo",
      mode: "transit",
      legs,
    });
  }
  const ranked = rankJourneyRoutes(routes);
  return {
    source: "demo" as const,
    routes: ranked,
    stops: [stop],
    alerts: [],
    nearestStop: stop,
    message,
  };
}

function normalizedRef(value: string): string {
  return value.trim().toLowerCase();
}

function matchingCatalogLines(
  route: ParsedGoogleRoute,
  catalog: TransitCatalog | undefined,
): TransitLine[] {
  if (!catalog) return [];
  const routeRefs = new Set(route.lineRefs.map(normalizedRef));
  return catalog.lines.filter((line) =>
    [line.name, ...line.refs].some((ref) => routeRefs.has(normalizedRef(ref))),
  );
}

function findVtaStop(
  boarding: BoardingStop | undefined,
  catalogStops: JourneyStop[],
): JourneyStop | undefined {
  if (!boarding) return undefined;
  const normalizedName = normalizedRef(boarding.name);
  const exact = catalogStops.find(
    (stop) => !!boarding.id && normalizedRef(stop.id) === normalizedRef(boarding.id),
  );
  if (exact) return exact;
  const sameName = catalogStops.find(
    (stop) => normalizedRef(stop.name) === normalizedName,
  );
  if (sameName) return sameName;
  if (boarding.lat === undefined || boarding.lng === undefined) return undefined;
  const nearest = catalogStops
    .map((stop) => ({
      stop,
      distance: distanceMeters(boarding.lat!, boarding.lng!, stop.lat, stop.lng),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest && nearest.distance <= 250 ? nearest.stop : undefined;
}

function allowMapImageRequest(ip: string): boolean {
  const now = Date.now();
  for (const [key, timestamps] of mapImageRequestsByIp) {
    const recent = timestamps.filter((timestamp) => timestamp > now - MAP_IMAGE_RATE_WINDOW_MS);
    if (recent.length) mapImageRequestsByIp.set(key, recent);
    else mapImageRequestsByIp.delete(key);
  }
  if (mapImageRequestsByIp.size >= 2_048 && !mapImageRequestsByIp.has(ip)) {
    const oldestIp = mapImageRequestsByIp.keys().next().value;
    if (oldestIp) mapImageRequestsByIp.delete(oldestIp);
  }
  const timestamps = mapImageRequestsByIp.get(ip) ?? [];
  if (timestamps.length >= MAP_IMAGE_RATE_LIMIT) return false;
  timestamps.push(now);
  mapImageRequestsByIp.set(ip, timestamps);
  return true;
}

function getCachedMapImage(
  key: string,
): { buffer: Buffer; contentType: string } | undefined {
  const cached = mapImageCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    mapImageCache.delete(key);
    return undefined;
  }
  return cached.value;
}

function cacheMapImage(key: string, image: Buffer, contentType: string): void {
  const now = Date.now();
  for (const [cacheKey, value] of mapImageCache) {
    if (value.expiresAt <= now) mapImageCache.delete(cacheKey);
  }
  while (mapImageCache.size >= MAX_MAP_IMAGE_CACHE_ENTRIES) {
    const oldestKey = mapImageCache.keys().next().value;
    if (!oldestKey) break;
    mapImageCache.delete(oldestKey);
  }
  mapImageCache.set(key, {
    value: { buffer: image, contentType },
    expiresAt: now + MAP_IMAGE_TTL_MS,
  });
}

async function fetchGoogleWalkingRoute(
  lat: number,
  lng: number,
  destination: string | { lat: number; lng: number },
): Promise<ParsedGoogleRoute | undefined> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return undefined;
  try {
    const response = await fetch(GOOGLE_COMPUTE_ROUTES_URL, {
      method: "POST",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: lat, longitude: lng } } },
        destination: typeof destination === "string"
          ? { address: destination }
          : { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: "WALK",
        units: "METRIC",
      }),
    });
    if (!response.ok) {
      // Log only Google's machine-readable error category, never its message
      // or the request: either can contain credential-bearing details.
      const body = asRecord(await response.json().catch(() => undefined));
      const error = asRecord(body?.error);
      const reason = objectList(error?.details)
        .map((detail) => detail.reason)
        .find((value): value is string => typeof value === "string" && /^[A-Z_]{3,80}$/.test(value));
      logger.warn({
        provider: "Google Maps", status: response.status,
        category: typeof error?.status === "string" && /^[A-Z_]{3,80}$/.test(error.status) ? error.status : undefined,
        reason,
      }, "Journey walking route unavailable");
      return undefined;
    }
    const payload = asRecord(await response.json());
    const routes = Array.isArray(payload?.routes) ? payload.routes : [];
    const route = asRecord(routes[0]);
    if (!route) return undefined;
    const durationText = safeText(route.duration) ?? "";
    const durationSeconds = Number(durationText.replace(/s$/, "")) || 0;
    const distanceMetersValue = numberField(route, ["distanceMeters"]) ?? 0;
    const encodedPolyline = safePolyline(asRecord(route.polyline)?.encodedPolyline);
    const legs = Array.isArray(route.legs) ? route.legs : [];
    const firstLeg = asRecord(legs[0]);
    const lastLeg = asRecord(legs[legs.length - 1]);
    const startLocation = asRecord(getPath(firstLeg ?? {}, "startLocation", "latLng"));
    const endLocation = asRecord(getPath(lastLeg ?? {}, "endLocation", "latLng"));
    const startLat = startLocation ? numberField(startLocation, ["latitude"]) : lat;
    const startLng = startLocation ? numberField(startLocation, ["longitude"]) : lng;
    const endLat = endLocation ? numberField(endLocation, ["latitude"]) : lat;
    const endLng = endLocation ? numberField(endLocation, ["longitude"]) : lng;
    const boarding: JourneyStop = {
      id: "walk-start",
      name: "Starting location",
      lat: startLat ?? lat,
      lng: startLng ?? lng,
    };
    const alighting: JourneyStop = {
      id: "walk-end",
      name: typeof destination === "string" ? destination : "Walking destination",
      lat: endLat ?? lat,
      lng: endLng ?? lng,
    };
    const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    const journeyRoute: JourneyRoute = {
      id: "walking-route",
      name: "Walk the whole way",
      startStop: boarding.name,
      destinationStop: alighting.name,
      durationMinutes,
      walkingMeters: Math.round(distanceMetersValue),
      transfers: 0,
      delayMinutes: 0,
      alerts: [],
      available: true,
      recommended: false,
      source: "live",
      mode: "walking",
      legs: [
        {
          type: "walk",
          routeNumber: null,
          routeName: null,
          boardingStop: boarding,
          alightingStop: alighting,
          distanceMeters: Math.round(distanceMetersValue),
          durationMinutes,
          delayMinutes: null,
          predictedArrival: null,
          transferGuidance: null,
          polyline: encodedPolyline,
        },
      ],
      ...(encodedPolyline ? { polyline: encodedPolyline } : {}),
    };
    return { route: journeyRoute, lineRefs: [], legStops: [] };
  } catch {
    return undefined;
  }
}

const walkSegmentCache = new Map<string, CacheEntry<ParsedGoogleRoute | undefined>>();
const walkSegmentInFlight = new Map<string, Promise<ParsedGoogleRoute | undefined>>();
async function walkingSegment(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}:${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
  const cached = walkSegmentCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = walkSegmentInFlight.get(key);
  if (existing) return existing;
  const pending = fetchGoogleWalkingRoute(from.lat, from.lng, to)
    .then((route) => {
      walkSegmentCache.set(key, { value: route, expiresAt: Date.now() + GOOGLE_ROUTES_TTL_MS });
      for (const [cacheKey, entry] of walkSegmentCache) {
        if (entry.expiresAt <= Date.now()) walkSegmentCache.delete(cacheKey);
      }
      while (walkSegmentCache.size > 128) {
        const first = walkSegmentCache.keys().next().value;
        if (!first) break;
        walkSegmentCache.delete(first);
      }
      return route;
    }).finally(() => walkSegmentInFlight.delete(key));
  walkSegmentInFlight.set(key, pending);
  return pending;
}

function toJourneyStop(stop: GtfsStop): JourneyStop {
  return { id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng };
}

async function buildGtfsRoute(
  candidate: GtfsJourney,
  index: number,
  feed: Feed,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  catalog: TransitCatalog | undefined,
  monitored: Map<string, StopPrediction[]>,
): Promise<{ route: JourneyRoute; walkingEstimated: boolean }> {
  const legs: JourneyLeg[] = [];
  let walkingEstimated = false;
  let walkingMeters = 0;
  let originWalkDuration = 0;
  let destinationWalkDuration = 0;
  let missedConnection = false;
  const makeWalk = async (
    from: { lat: number; lng: number; name: string; id: string },
    to: { lat: number; lng: number; name: string; id: string },
    fallbackMinutes: number,
  ) => {
    if (distanceMeters(from.lat, from.lng, to.lat, to.lng) < 25) return 0;
    const result = await walkingSegment(from, to);
    const actual = result?.route.legs[0];
    if (!actual) walkingEstimated = true;
    const meters = actual?.distanceMeters ?? distanceMeters(from.lat, from.lng, to.lat, to.lng);
    walkingMeters += meters;
    const duration = actual?.durationMinutes ?? fallbackMinutes;
    legs.push({
      type: "walk", routeNumber: null, routeName: null,
      boardingStop: toJourneyStop(from), alightingStop: toJourneyStop(to),
      distanceMeters: meters, durationMinutes: duration,
      delayMinutes: null, predictedArrival: null, transferGuidance: null,
      polyline: actual?.polyline ?? null,
    });
    return duration;
  };
  const firstRide = candidate.rides[0];
  originWalkDuration = await makeWalk(
    { ...origin, id: "journey-origin", name: "Starting location" },
    firstRide.boarding, candidate.originWalkMinutes,
  );
  for (const [rideIndex, ride] of candidate.rides.entries()) {
    const matching = (monitored.get(ride.boarding.id) ?? []).filter((prediction) =>
      normalizedRef(prediction.lineRef) === normalizedRef(ride.routeNumber) ||
      normalizedRef(prediction.lineRef) === normalizedRef(ride.routeId));
    const delay = matching.length
      ? matching.reduce((max, prediction) => Math.max(max, prediction.delayMinutes), 0)
      : null;
    const nextRide = candidate.rides[rideIndex + 1];
    legs.push({
      type: "bus", routeNumber: ride.routeNumber, routeName: ride.routeName,
      boardingStop: toJourneyStop(ride.boarding), alightingStop: toJourneyStop(ride.alighting),
      distanceMeters: ride.distanceMeters, durationMinutes: Math.max(1, Math.ceil((ride.arrival - ride.departure) / 60)),
      delayMinutes: delay, predictedArrival: scheduledTimestamp(feed, ride.arrival + (delay ?? 0) * 60),
      transferGuidance: nextRide
        ? `Transfer to ${nextRide.routeNumber} at ${ride.alighting.name}.`
        : null,
      polyline: ride.polyline,
    });
    if (nextRide) {
      const transferMinutes = await makeWalk(ride.alighting, nextRide.boarding, 1);
      if (ride.arrival + transferMinutes * 60 + 180 > nextRide.departure) missedConnection = true;
    }
  }
  const lastRide = candidate.rides[candidate.rides.length - 1];
  destinationWalkDuration = await makeWalk(lastRide.alighting,
    { ...destination, id: "journey-destination", name: "Destination" },
    candidate.destinationWalkMinutes);
  if (feed.secondsNow + originWalkDuration * 60 > firstRide.departure) missedConnection = true;
  const lineRefs = new Set(candidate.rides.flatMap((ride) =>
    [ride.routeId, ride.routeNumber].map(normalizedRef)));
  const alerts = (catalog?.alerts ?? [])
    .filter((alert) => alert.lineRefs.some((ref) => lineRefs.has(normalizedRef(ref))))
    .map((alert) => alert.text);
  const delayMinutes = legs.reduce((sum, leg) => sum + (leg.delayMinutes ?? 0), 0);
  return {
    walkingEstimated,
    route: {
      id: `vta-schedule-${createHash("sha256").update(candidate.rides.map((ride) =>
        [ride.routeId, ride.boarding.id, ride.alighting.id, ride.departure].join(":")).join("|")).digest("hex").slice(0, 16)}`, name: candidate.rides.map((ride) =>
        `${ride.routeNumber} · ${ride.routeName}`).join(" → "),
      startStop: firstRide.boarding.name, destinationStop: lastRide.alighting.name,
      durationMinutes: Math.ceil((lastRide.arrival - feed.secondsNow) / 60) + destinationWalkDuration + delayMinutes,
      walkingMeters: walkingMeters || candidate.walkingMeters,
      transfers: candidate.rides.length - 1, delayMinutes,
      alerts: [...new Set(alerts)], available: !missedConnection, recommended: false,
      source: "live", mode: "transit", legs,
    },
  };
}

function buildRouteLegs(
  route: ParsedGoogleRoute,
  catalog: TransitCatalog | undefined,
  monitoredStops: Map<string, StopPrediction[]>,
): JourneyLeg[] {
  return route.legStops.map((legStop, index) => {
    const matchedStop =
      legStop.type === "bus" ? findVtaStop(legStop.boarding, catalog?.stops ?? []) : undefined;
    const boardingStop: JourneyStop = matchedStop ?? {
      id: legStop.boarding.id ?? `${route.route.id}-leg-${index}-board`,
      name: legStop.boarding.name,
      lat: legStop.boarding.lat ?? 0,
      lng: legStop.boarding.lng ?? 0,
    };
    const alightingMatch =
      legStop.type === "bus" ? findVtaStop(legStop.alighting, catalog?.stops ?? []) : undefined;
    const alightingStop: JourneyStop = alightingMatch ?? {
      id: legStop.alighting.id ?? `${route.route.id}-leg-${index}-alight`,
      name: legStop.alighting.name,
      lat: legStop.alighting.lat ?? 0,
      lng: legStop.alighting.lng ?? 0,
    };
    let delayMinutes: number | null = null;
    let predictedArrival: string | null = null;
    if (legStop.type === "bus" && matchedStop) {
      const canonicalRefs = new Set(
        [legStop.routeNumber, legStop.routeName].filter((ref): ref is string => !!ref).map(normalizedRef),
      );
      const predictions = monitoredStops.get(matchedStop.id) ?? [];
      const matching = predictions.filter((prediction) => canonicalRefs.has(normalizedRef(prediction.lineRef)));
      if (matching.length) {
        delayMinutes = matching.reduce((max, prediction) => Math.max(max, prediction.delayMinutes), 0);
      }
      if (matching.length && legStop.scheduledDeparture !== undefined) {
        const delaySeconds = (delayMinutes ?? 0) * 60;
        predictedArrival = new Date(legStop.scheduledDeparture * 1000 + delaySeconds * 1000).toISOString();
      }
    }
    const nextLeg = route.legStops[index + 1];
    const transferGuidance =
      legStop.type === "bus" && nextLeg && nextLeg.type === "bus"
        ? `Transfer to ${nextLeg.routeName ?? nextLeg.routeNumber ?? "the next bus"} at ${alightingStop.name}.`
        : null;
    return {
      type: legStop.type,
      routeNumber: legStop.routeNumber,
      routeName: legStop.routeName,
      boardingStop,
      alightingStop,
      distanceMeters: legStop.distanceMeters,
      durationMinutes: legStop.durationMinutes,
      delayMinutes,
      predictedArrival,
      transferGuidance,
      polyline: legStop.polyline,
    };
  });
}

async function buildJourney(lat: number, lng: number, destination: string, mode: TravelMode) {
  const [{ walkingRoute }, catalog, feed] = await Promise.all([
    fetchCachedGoogleRoutes(lat, lng, destination),
    get511Catalog(),
    mode === "walking" ? Promise.resolve(undefined) : getVtaGtfs(),
  ]);
  if (mode === "walking" && !walkingRoute) {
    return demoJourney(
      lat, lng, destination,
      "Google walking directions are unavailable; showing an illustrative walking option.",
      mode,
    );
  }
  if ((mode === "transit" && !feed) || (!walkingRoute && !feed)) {
    return demoJourney(
      lat,
      lng,
      destination,
      feed
        ? "511 VTA schedule and Google walking directions are unavailable; showing demo data."
        : "511 VTA schedule is unavailable; showing demo bus data.",
      mode,
    );
  }
  const destinationName = normalizedRef(destination);
  const namedStop = catalog?.stops.find((stop) => normalizedRef(stop.name) === destinationName) ??
    (feed ? [...feed.stops.values()].find((stop) => normalizedRef(stop.name) === destinationName) : undefined);
  const coordinates = walkingRoute?.route.legs[0]?.alightingStop ?? namedStop;
  const candidates = feed && coordinates && mode !== "walking"
    ? findVtaJourneys(feed, { lat, lng }, coordinates)
    : [];
  const monitoredStops = new Map<string, StopPrediction[]>();
  if (catalog?.agency && candidates.length) {
    const boardings = [...new Set(candidates.slice(0, 5).flatMap((candidate) =>
      candidate.rides.map((ride) => ride.boarding.id)))].slice(0, 6);
    await Promise.all(boardings.map(async (id) => {
      const predictions = await getStopMonitoringAlerts(
        process.env.TRANSIT_511_API_KEY, catalog.agency, id,
      );
      monitoredStops.set(id, predictions);
    }));
  }
  const built = coordinates && feed
    ? await Promise.all(candidates.slice(0, 5).map((candidate, index) =>
      buildGtfsRoute(candidate, index, feed, { lat, lng }, coordinates, catalog, monitoredStops)))
    : [];
  const transitJourneyRoutes = built.map(({ route }) => route);
  const busStops = feed
    ? [...feed.byStop.keys()].map((id) => feed.stops.get(id)).filter((stop): stop is GtfsStop => !!stop).map(toJourneyStop)
    : catalog?.stops ?? [];
  const stops = busStops
    .map((stop) => ({
      ...stop,
      distanceMeters: distanceMeters(lat, lng, stop.lat, stop.lng),
    }))
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
    .slice(0, 12);
  const alerts = [...new Set((catalog?.alerts ?? []).map((alert) => alert.text))];
  const walkingJourneyRoutes = mode !== "transit" && walkingRoute ? [walkingRoute.route] : [];
  const demoBusRoutes = mode === "any" && !feed
    ? demoJourney(lat, lng, destination, "VTA schedule unavailable; bus option is a demo.", "transit").routes
    : [];
  const rankedRoutes = rankJourneyRoutes([...transitJourneyRoutes, ...walkingJourneyRoutes, ...demoBusRoutes]);
  const nearestStop = stops[0] ?? null;
  const notices: string[] = [];
  if (feed && mode !== "walking") notices.push("VTA bus trips use the 511 published schedule; arrival estimates are not live vehicle positions.");
  if (!catalog?.complete && mode !== "walking") notices.push(catalog?.message ?? "511 real-time feeds are unavailable; delays and alerts may be missing.");
  if (!feed && mode !== "walking") notices.push("511 VTA schedule is unavailable; the bus option is an illustrative demo.");
  if (built.some(({ walkingEstimated }) => walkingEstimated)) notices.push("Some connecting walks use straight-line estimates because walking directions were unavailable.");
  if (mode !== "walking" && !transitJourneyRoutes.length) notices.push("No scheduled VTA bus option was found for this destination and time.");
  if (!walkingRoute && mode !== "transit") notices.push("Google walking directions are unavailable.");
  return {
    source: rankedRoutes.length ? "live" as const : "demo" as const,
    routes: rankedRoutes,
    stops,
    alerts,
    nearestStop,
    ...(notices.length ? { message: notices.join(" ") } : {}),
  };
}

function parseTravelMode(value: string | undefined): TravelMode {
  return value === "walking" || value === "transit" ? value : "any";
}

router.get("/journey/options", async (req, res): Promise<void> => {
  const query = GetJourneyOptionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid journey query parameters." });
    return;
  }
  const response = await buildJourney(
    query.data.lat,
    query.data.lng,
    query.data.destination,
    parseTravelMode(query.data.mode),
  );
  res.json(GetJourneyOptionsResponse.parse(response));
});

router.get("/journey/map", async (req, res): Promise<void> => {
  const query = GetJourneyMapQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid journey query parameters." });
    return;
  }
  const journey = await buildJourney(
    query.data.lat,
    query.data.lng,
    query.data.destination,
    parseTravelMode(query.data.mode),
  );
  const selectedRoute =
    (query.data.routeId ? journey.routes.find((route) => route.id === query.data.routeId) : undefined) ??
    journey.routes.find((route) => route.recommended) ??
    journey.routes[0];
  let mapImageUrl: string | null = null;
  if (process.env.GOOGLE_MAPS_API_KEY && selectedRoute) {
    const paths = selectedRoute.legs
      .filter((leg) => !!leg.polyline)
      .map((leg, index) => ({
        encoded: leg.polyline as string,
        color: leg.type === "walk" ? LEG_COLORS.walk : LEG_COLORS.bus[index % LEG_COLORS.bus.length],
      }));
    const markerSeen = new Set<string>();
    const markers: MapSpec["markers"] = [];
    for (const leg of selectedRoute.legs) {
      for (const [stop, color] of [
        [leg.boardingStop, leg.type === "bus" ? "0x1565C0FF" : "0x64748BFF"],
        [leg.alightingStop, leg.type === "bus" ? "0x1565C0FF" : "0x64748BFF"],
      ] as const) {
        const key = `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`;
        if (markerSeen.has(key)) continue;
        markerSeen.add(key);
        markers.push({ lat: stop.lat, lng: stop.lng, color, label: stop.name });
      }
    }
    const token = storeMapSpec({ lat: query.data.lat, lng: query.data.lng, paths, markers: markers.slice(0, 15) });
    mapImageUrl = `/api/journey/map-image?token=${encodeURIComponent(token)}`;
  }
  res.json(
    GetJourneyMapResponse.parse({
      ...journey,
      mapImageUrl,
      map3dAvailable: Boolean(process.env.GOOGLE_MAPS_BROWSER_API_KEY && selectedRoute?.source === "live" &&
        selectedRoute.legs.some((leg) => !!leg.polyline)),
      ...(mapImageUrl === null && !journey.message
        ? { message: "Google Maps credentials are not configured; map image unavailable." }
        : {}),
    }),
  );
});

router.get("/journey/map-3d", async (req, res): Promise<void> => {
  const query = GetJourneyMapQueryParams.safeParse(req.query);
  const heat = parseHeatPoints(req.query.heat);
  const key = process.env.GOOGLE_MAPS_BROWSER_API_KEY;
  if (!query.success || !query.data.routeId || !heat) {
    res.status(400).json({ error: "Invalid 3D map parameters." });
    return;
  }
  if (!key) {
    res.status(503).json({ error: "Google 3D maps are not configured." });
    return;
  }
  if (!allowMapImageRequest(req.ip || req.socket.remoteAddress || "unknown")) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Map request limit reached; retry shortly." });
    return;
  }
  const journey = await buildJourney(
    query.data.lat, query.data.lng, query.data.destination, parseTravelMode(query.data.mode),
  );
  const selected = journey.routes.find((route) => route.id === query.data.routeId && route.source === "live");
  if (!selected || !selected.legs.some((leg) => !!leg.polyline)) {
    res.status(404).json({ error: "Route has changed; refresh journey options." });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.type("html").send(renderGoogle3DMap(key, selected.legs, heat, {
    lat: query.data.lat, lng: query.data.lng,
  }));
});

router.get("/journey/map-image", async (req, res): Promise<void> => {
  const query = GetJourneyMapImageQueryParams.safeParse(req.query);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!query.success) {
    res.status(400).json({ error: "Invalid map query parameters." });
    return;
  }
  if (!apiKey) {
    res.status(503).json({ error: "Static maps are not configured." });
    return;
  }
  const spec = getMapSpec(query.data.token);
  if (!spec) {
    res.status(503).json({ error: "Static map is temporarily unavailable; request a fresh map." });
    return;
  }
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!allowMapImageRequest(ip)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Map image request limit reached; retry shortly." });
    return;
  }
  const cachedImage = getCachedMapImage(query.data.token);
  if (cachedImage) {
    res.setHeader("Content-Type", cachedImage.contentType);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(cachedImage.buffer);
    return;
  }
  const url = new URL(GOOGLE_STATIC_MAP_URL);
  url.searchParams.set("center", `${spec.lat},${spec.lng}`);
  url.searchParams.set("zoom", "14");
  url.searchParams.set("size", "640x640");
  url.searchParams.set("maptype", "roadmap");
  url.searchParams.set("key", apiKey);
  for (const path of spec.paths.slice(0, 8)) {
    url.searchParams.append("path", `color:${path.color}|weight:5|enc:${path.encoded}`);
  }
  const markersByColor = new Map<string, string[]>();
  for (const marker of spec.markers.slice(0, 15)) {
    const list = markersByColor.get(marker.color) ?? [];
    list.push(`${marker.lat},${marker.lng}`);
    markersByColor.set(marker.color, list);
  }
  for (const [color, points] of markersByColor) {
    url.searchParams.append("markers", `color:${color}|${points.join("|")}`);
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !response.ok ||
      !["image/png", "image/jpeg"].includes(contentType.split(";")[0].trim())
    ) {
      req.log.warn({ provider: "Google Maps", status: response.status, image: contentType.startsWith("image/") }, "Journey map image unavailable");
      res.status(503).json({ error: "Static map is temporarily unavailable." });
      return;
    }
    const image = Buffer.from(await response.arrayBuffer());
    cacheMapImage(query.data.token, image, contentType.split(";")[0].trim());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(image);
  } catch {
    res.status(503).json({ error: "Static map is temporarily unavailable." });
  }
});

router.get("/journey/catalog", async (req, res): Promise<void> => {
  const query = GetJourneyCatalogQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid catalog query parameters." });
    return;
  }
  const catalog = await get511Catalog();
  if (!catalog?.complete) {
    const feed = await getVtaGtfs();
    if (feed) {
      const search = query.data.query?.trim().toLowerCase() ?? "";
      const routes = [...feed.routes.values()]
        .map((route) => `${route.number} · ${route.name}`)
        .filter((name) => name.toLowerCase().includes(search));
      const stops = [...feed.byStop.keys()]
        .map((id) => feed.stops.get(id))
        .filter((stop): stop is GtfsStop => !!stop && stop.name.toLowerCase().includes(search))
        .slice(0, 40).map(toJourneyStop);
      res.json(GetJourneyCatalogResponse.parse({
        source: "live", routes: [...new Set(routes)], stops,
        message: "VTA stops and bus lines from the 511 published schedule; live alerts may be unavailable.",
      }));
      return;
    }
    res.json(
      GetJourneyCatalogResponse.parse({
        source: "demo",
        routes: [],
        stops: [],
        message:
          catalog?.message ??
          (process.env.TRANSIT_511_API_KEY
            ? "VTA catalog is incomplete or temporarily unavailable; no live catalog is shown."
            : "511 credentials are not configured; no live catalog data is shown."),
      }),
    );
    return;
  }
  const search = query.data.query?.trim().toLowerCase();
  const matchingLines = search
    ? catalog.lines.filter((line) => [line.name, ...line.refs].some((ref) => ref.toLowerCase().includes(search)))
    : catalog.lines;
  const exactNumberMatches = search && /^\d+$/.test(search)
    ? matchingLines.filter((line) => line.refs.some((ref) => ref.toLowerCase() === search))
    : [];
  const response = {
    source: "live" as const,
    routes: search
      ? [...new Set((exactNumberMatches.length ? exactNumberMatches : matchingLines).map(lineLabel))]
      : catalog.routes,
    stops: search
      ? catalog.stops.filter((stop) => stop.name.toLowerCase().includes(search))
      : catalog.stops,
  };
  res.json(GetJourneyCatalogResponse.parse(response));
});

export default router;