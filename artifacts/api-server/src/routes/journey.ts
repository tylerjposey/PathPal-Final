import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
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
const GOOGLE_DIRECTIONS_URL =
  "https://maps.googleapis.com/maps/api/directions/json";
const GOOGLE_STATIC_MAP_URL =
  "https://maps.googleapis.com/maps/api/staticmap";
const UPSTREAM_TIMEOUT_MS = 8_000;
const CATALOG_TTL_MS = 15 * 60_000;
const STOP_MONITORING_TTL_MS = 60_000;
const STOP_MONITORING_FAILURE_TTL_MS = 30_000;
const MAP_IMAGE_TTL_MS = 5 * 60_000;
const MAP_IMAGE_RATE_WINDOW_MS = 60_000;
const MAP_IMAGE_RATE_LIMIT = 8;
const MAX_MAP_IMAGE_CACHE_ENTRIES = 128;
const MAX_511_REQUESTS_PER_HOUR = 55;

type JourneyStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distanceMeters?: number;
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
};

type BoardingStop = {
  id?: string;
  name: string;
  lat?: number;
  lng?: number;
};

type ParsedGoogleRoute = {
  route: JourneyRoute;
  lineRefs: string[];
  boardingStop?: BoardingStop;
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
  for (const [key, value] of Object.entries(record)) {
    if (
      names.some((name) => key.toLowerCase().replace(/[^a-z]/g, "") === name)
    ) {
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

function parseGoogleRoute(
  route: Record<string, unknown>,
  index: number,
): ParsedGoogleRoute | undefined {
  const legs = Array.isArray(route.legs) ? route.legs : [];
  if (!legs.length) return undefined;
  let walkingMeters = 0;
  let durationSeconds = 0;
  let transitBoardings = 0;
  const lineNames: string[] = [];
  const lineRefs: string[] = [];
  let startStop: string | undefined;
  let destinationStop: string | undefined;
  let boardingStop: BoardingStop | undefined;
  for (const legValue of legs) {
    const leg = asRecord(legValue);
    if (!leg) continue;
    const legDuration = asRecord(leg.duration);
    durationSeconds += numberField(legDuration ?? {}, ["value"]) ?? 0;
    const steps = Array.isArray(leg.steps) ? leg.steps : [];
    for (const stepValue of steps) {
      const step = asRecord(stepValue);
      if (!step) continue;
      const mode = safeText(step.travel_mode);
      if (mode === "WALKING") {
        walkingMeters += numberField(asRecord(step.distance) ?? {}, ["value"]) ?? 0;
      }
      if (mode !== "TRANSIT") continue;
      const details = asRecord(step.transit_details);
      if (!details) continue;
      transitBoardings += 1;
      const departure = asRecord(details.departure_stop);
      const arrival = asRecord(details.arrival_stop);
      startStop ??= safeText(departure?.name);
      destinationStop = safeText(arrival?.name) ?? destinationStop;
      if (!boardingStop && departure) {
        const location = asRecord(departure.location);
        const lat = location ? numberField(location, ["lat", "latitude"]) : undefined;
        const lng = location ? numberField(location, ["lng", "lon", "longitude"]) : undefined;
        boardingStop = {
          ...(safeText(departure.id) ?? safeText(departure.place_id)
            ? { id: safeText(departure.id) ?? safeText(departure.place_id) }
            : {}),
          name: safeText(departure.name) ?? "Boarding stop",
          ...(lat !== undefined ? { lat } : {}),
          ...(lng !== undefined ? { lng } : {}),
        };
      }
      const line = asRecord(details.line);
      const shortName = safeText(line?.short_name);
      const fullName = safeText(line?.name);
      for (const lineName of [shortName, fullName]) {
        if (lineName && !lineNames.includes(lineName)) lineNames.push(lineName);
        if (lineName && !lineRefs.includes(lineName)) lineRefs.push(lineName);
      }
    }
  }
  const overview = asRecord(route.overview_polyline);
  const encodedPolyline = safeText(overview?.points);
  const firstLeg = asRecord(legs[0]);
  const lastLeg = asRecord(legs[legs.length - 1]);
  const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
  const routeName = lineNames.length ? lineNames.join(" → ") : `Transit option ${index + 1}`;
  const journeyRoute: JourneyRoute = {
    id: `google-route-${index + 1}`,
    name: lineNames.length ? lineNames.join(" → ") : routeName,
    startStop:
      startStop ??
      safeText(firstLeg?.start_address) ??
      "Starting location",
    destinationStop:
      destinationStop ??
      safeText(lastLeg?.end_address) ??
      "Destination",
    durationMinutes,
    walkingMeters: Math.round(walkingMeters),
    transfers: Math.max(0, transitBoardings - 1),
    delayMinutes: 0,
    alerts: [],
    available: true,
    recommended: false,
    source: "live",
    ...(encodedPolyline ? { polyline: encodedPolyline } : {}),
  };
  return {
    route: journeyRoute,
    lineRefs,
    ...(boardingStop ? { boardingStop } : {}),
  };
}

async function fetchGoogleDirections(
  lat: number,
  lng: number,
  destination: string,
): Promise<{ routes: ParsedGoogleRoute[]; stops: JourneyStop[] } | undefined> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return undefined;
  const url = new URL(GOOGLE_DIRECTIONS_URL);
  url.searchParams.set("origin", `${lat},${lng}`);
  url.searchParams.set("destination", destination);
  url.searchParams.set("mode", "transit");
  url.searchParams.set("alternatives", "true");
  url.searchParams.set("key", apiKey);
  try {
    const payload = asRecord(await fetchJson(url));
    if (payload?.status !== "OK" || !Array.isArray(payload.routes)) {
      logger.warn({ provider: "Google Maps", status: typeof payload?.status === "string" ? payload.status.slice(0, 32) : "invalid response" }, "Journey directions unavailable");
      return undefined;
    }
    const routes = payload.routes
      .map((item, index) => {
        const record = asRecord(item);
        return record ? parseGoogleRoute(record, index) : undefined;
      })
      .filter((route): route is ParsedGoogleRoute => !!route);
    if (!routes.length) return undefined;

    const stopMap = new Map<string, JourneyStop>();
    for (const routeValue of payload.routes) {
      const route = asRecord(routeValue);
      const legs = Array.isArray(route?.legs) ? route.legs : [];
      for (const legValue of legs) {
        const leg = asRecord(legValue);
        const steps = Array.isArray(leg?.steps) ? leg.steps : [];
        for (const stepValue of steps) {
          const details = asRecord(asRecord(stepValue)?.transit_details);
          if (!details) continue;
          for (const stopKey of ["departure_stop", "arrival_stop"]) {
            const stop = asRecord(details[stopKey]);
            const location = asRecord(stop?.location);
            if (!stop || !location) continue;
            const stopLat = numberField(location, ["lat", "latitude"]);
            const stopLng = numberField(location, ["lng", "lon", "longitude"]);
            const name = safeText(stop.name);
            if (
              stopLat === undefined ||
              stopLng === undefined ||
              !name ||
              Math.abs(stopLat) > 90 ||
              Math.abs(stopLng) > 180
            ) {
              continue;
            }
            const id =
              safeText(stop.id) ??
              `${name.toLowerCase()}-${stopLat.toFixed(5)}-${stopLng.toFixed(5)}`;
            stopMap.set(id, {
              id,
              name,
              lat: stopLat,
              lng: stopLng,
            });
          }
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

function demoJourney(lat: number, lng: number, destination: string, message: string) {
  const stop: JourneyStop = {
    id: "demo-origin-stop",
    name: "Demo nearby stop",
    lat,
    lng,
    distanceMeters: 0,
  };
  const route: JourneyRoute = {
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
    recommended: true,
    source: "demo",
  };
  return {
    source: "demo" as const,
    routes: [route],
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

function findVtaBoardingStop(
  route: ParsedGoogleRoute,
  catalogStops: JourneyStop[],
): JourneyStop | undefined {
  const boarding = route.boardingStop;
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

async function buildJourney(lat: number, lng: number, destination: string) {
  const [directions, catalog] = await Promise.all([
    fetchGoogleDirections(lat, lng, destination),
    get511Catalog(),
  ]);
  if (!directions) {
    const missingKeys = !process.env.GOOGLE_MAPS_API_KEY;
    return demoJourney(
      lat,
      lng,
      destination,
      missingKeys
        ? "Google Maps credentials are not configured; showing demo data."
        : "Live directions are temporarily unavailable; showing demo data.",
    );
  }
  const stops = (catalog?.stops.length ? catalog.stops : directions.stops)
    .map((stop) => ({
      ...stop,
      distanceMeters: distanceMeters(lat, lng, stop.lat, stop.lng),
    }))
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
    .slice(0, 12);
  const alerts = [...new Set((catalog?.alerts ?? []).map((alert) => alert.text))];
  const routeBoardings = directions.routes.map((route) => ({
    route,
    stop: findVtaBoardingStop(route, catalog?.stops ?? []),
  }));
  const monitoredStops = new Map<string, StopPrediction[]>();
  const routesToMonitor = routeBoardings
    .filter(
      (item): item is { route: ParsedGoogleRoute; stop: JourneyStop } =>
        !!item.stop && !!catalog?.agency,
    )
    .slice(0, 3);
  const uniqueStops = [
    ...new Map(routesToMonitor.map(({ stop }) => [stop.id, stop])).values(),
  ];
  await Promise.all(
    uniqueStops.map(async (stop) => {
      const predictions = await getStopMonitoringAlerts(
        process.env.TRANSIT_511_API_KEY,
        catalog?.agency,
        stop.id,
      );
      monitoredStops.set(stop.id, predictions);
    }),
  );

  const rankedRoutes = rankJourneyRoutes(
    routeBoardings.map(({ route, stop }) => {
      const matchedLines = matchingCatalogLines(route, catalog);
      const canonicalRefs = new Set(
        [
          ...route.lineRefs,
          ...matchedLines.flatMap((line) => [line.name, ...line.refs]),
        ].map(normalizedRef),
      );
      const matchedAlerts = (catalog?.alerts ?? [])
        .filter((alert) =>
          alert.lineRefs.some((lineRef) => canonicalRefs.has(normalizedRef(lineRef))),
        )
        .map((alert) => alert.text);
      const predictions = stop ? monitoredStops.get(stop.id) ?? [] : [];
      const matchingPredictions = predictions.filter((prediction) =>
        canonicalRefs.has(normalizedRef(prediction.lineRef)),
      );
      const delayMinutes = matchingPredictions.reduce(
        (max, prediction) => Math.max(max, prediction.delayMinutes),
        0,
      );
      return {
        ...route.route,
        alerts: [...new Set(matchedAlerts)],
        delayMinutes,
      };
    }),
  );
  const nearestStop = stops[0] ?? null;
  return {
    source: "live" as const,
    routes: rankedRoutes,
    stops,
    alerts,
    nearestStop,
    ...(!catalog?.complete
      ? {
          message:
            catalog?.message ??
            "Live directions available; VTA catalog is incomplete or unavailable.",
        }
      : {}),
  };
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
  );
  const selectedPolyline =
    query.data.routePolyline ?? journey.routes.find((route) => route.recommended)?.polyline;
  const mapImageUrl = process.env.GOOGLE_MAPS_API_KEY
    ? `/api/journey/map-image?lat=${encodeURIComponent(query.data.lat)}&lng=${encodeURIComponent(query.data.lng)}${
        selectedPolyline
          ? `&routePolyline=${encodeURIComponent(selectedPolyline)}`
          : ""
      }`
    : null;
  res.json(
    GetJourneyMapResponse.parse({
      ...journey,
      mapImageUrl,
      ...(mapImageUrl === null && !journey.message
        ? { message: "Google Maps credentials are not configured; map image unavailable." }
        : {}),
    }),
  );
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
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!allowMapImageRequest(ip)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Map image request limit reached; retry shortly." });
    return;
  }
  const cacheKey = `${query.data.lat},${query.data.lng}:${query.data.routePolyline ?? ""}`;
  const cachedImage = getCachedMapImage(cacheKey);
  if (cachedImage) {
    res.setHeader("Content-Type", cachedImage.contentType);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(cachedImage.buffer);
    return;
  }
  const url = new URL(GOOGLE_STATIC_MAP_URL);
  url.searchParams.set("center", `${query.data.lat},${query.data.lng}`);
  url.searchParams.set("zoom", "14");
  url.searchParams.set("size", "640x640");
  url.searchParams.set("maptype", "roadmap");
  url.searchParams.set("key", apiKey);
  if (query.data.routePolyline) {
    url.searchParams.set(
      "path",
      `color:0x1565C0FF|weight:5|enc:${query.data.routePolyline}`,
    );
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
    cacheMapImage(cacheKey, image, contentType.split(";")[0].trim());
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