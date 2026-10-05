export type AlertPeriod = { start: string | null; end: string | null };
export type TransitFeedAlert = {
  providerId: string;
  originalText: string;
  status: string;
  activePeriods: AlertPeriod[];
  routeRefs: string[];
  stopRefs: string[];
  source: "511";
};

export type JourneyAlert = Omit<TransitFeedAlert, "routeRefs" | "stopRefs"> & {
  routeMatches: Array<{ routeId: string | null; routeNumber: string | null; routeName: string | null }>;
  stopMatches: Array<{ id: string; name: string }>;
  impact: "route_match" | "stop_match" | "route_and_stop_match" | "uncertain";
  fetchedAt: string;
};

export type AlertFeedParse = { valid: boolean; alerts: TransitFeedAlert[] };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function valueAt(value: unknown, name: string): unknown {
  const object = record(value);
  if (!object) return undefined;
  const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? object[key] : undefined;
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 2000);
  const object = record(value);
  if (!object) return undefined;
  const ref = valueAt(object, "ref");
  return typeof ref === "string" && ref.trim() ? ref.trim().slice(0, 2000) : undefined;
}

function firstText(value: unknown): string | undefined {
  const found = list(value)
    .flatMap((item) => list(valueAt(item, "translations")).map((translation) => valueAt(translation, "text")))
    .map(text)
    .find((item): item is string => !!item);
  return found;
}

function refsFromInformedEntities(value: unknown, field: "routeid" | "stopid"): string[] {
  return [...new Set(list(value).flatMap((entity) => {
    const result: string[] = [];
    for (const key of [field, field === "routeid" ? "route_id" : "stop_id"]) {
      const direct = text(valueAt(entity, key));
      if (direct) result.push(direct);
    }
    if (field === "routeid") {
      const trip = valueAt(entity, "trip");
      const routeId = text(valueAt(trip, "routeid")) ?? text(valueAt(trip, "route_id"));
      if (routeId) result.push(routeId);
    }
    return result;
  }))];
}

function recursiveRefs(value: unknown, wanted: string): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const object = record(node);
    if (!object) return;
    for (const [key, child] of Object.entries(object)) {
      if (key.toLowerCase() === wanted.toLowerCase()) {
        const childText = text(child);
        if (childText) found.push(childText);
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return [...new Set(found)];
}

function asTimestamp(seconds: unknown): string | null {
  const parsed = typeof seconds === "number"
    ? seconds
    : typeof seconds === "string" && seconds.trim() ? Number(seconds) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed * 1000).toISOString() : null;
}

function gtfsAlerts(payload: unknown, now: number): AlertFeedParse {
  const entities = valueAt(payload, "Entities");
  if (!Array.isArray(entities)) return { valid: false, alerts: [] };
  const alerts = entities.flatMap((entity, index) => {
    const alert = valueAt(entity, "Alert");
    if (!record(alert)) return [];
    const activePeriods = list(valueAt(alert, "ActivePeriods")).map((period) => ({
      start: asTimestamp(valueAt(period, "start")),
      end: asTimestamp(valueAt(period, "end")),
    }));
    const isActive = activePeriods.some((period) => {
      const start = period.start ? Date.parse(period.start) : Number.NEGATIVE_INFINITY;
      const end = period.end ? Date.parse(period.end) : Number.POSITIVE_INFINITY;
      return start <= now && end >= now;
    });
    if (activePeriods.length && !isActive) return [];
    const originalText = firstText(valueAt(alert, "HeaderText")) ??
      firstText(valueAt(alert, "DescriptionText"));
    if (!originalText) return [];
    const providerId = text(valueAt(entity, "Id")) ?? text(valueAt(alert, "id")) ?? `511-alert-${index + 1}`;
    const routeRefs = refsFromInformedEntities(valueAt(alert, "InformedEntities"), "routeid");
    const stopRefs = refsFromInformedEntities(valueAt(alert, "InformedEntities"), "stopid");
    return [{
      providerId,
      originalText,
      status: text(valueAt(alert, "Effect")) ?? "active",
      activePeriods,
      routeRefs,
      stopRefs,
      source: "511" as const,
    }];
  }).slice(0, 30);
  return { valid: true, alerts };
}

function siriAlerts(payload: unknown, now: number): AlertFeedParse {
  const delivery = valueAt(valueAt(payload, "Siri"), "ServiceDelivery");
  const exchange = valueAt(delivery, "SituationExchangeDelivery");
  if (!record(exchange)) return { valid: false, alerts: [] };
  const situations = valueAt(valueAt(exchange, "Situations"), "PtSituationElement");
  if (situations === undefined || situations === null) return { valid: true, alerts: [] };
  const alerts = list(situations).flatMap((situation, index) => {
    const originalText = text(valueAt(situation, "Summary")) ?? text(valueAt(situation, "Description"));
    if (!originalText) return [];
    const validity = list(valueAt(situation, "ValidityPeriod")).map((period) => ({
      start: text(valueAt(period, "StartTime")) ?? null,
      end: text(valueAt(period, "EndTime")) ?? null,
    }));
    const active = validity.some((period) => {
      const start = period.start ? Date.parse(period.start) : Number.NEGATIVE_INFINITY;
      const end = period.end ? Date.parse(period.end) : Number.POSITIVE_INFINITY;
      return (Number.isFinite(start) ? start : Number.NEGATIVE_INFINITY) <= now &&
        (Number.isFinite(end) ? end : Number.POSITIVE_INFINITY) >= now;
    });
    if (validity.length && !active) return [];
    const providerId =
      text(valueAt(situation, "SituationNumber")) ??
      text(valueAt(situation, "SituationRef")) ??
      text(valueAt(situation, "id")) ??
      `511-siri-alert-${index + 1}`;
    return [{
      providerId,
      originalText,
      status: text(valueAt(situation, "Progress")) ?? text(valueAt(situation, "Verification")) ?? "active",
      activePeriods: validity,
      routeRefs: recursiveRefs(situation, "LineRef"),
      stopRefs: recursiveRefs(situation, "StopPointRef"),
      source: "511" as const,
    }];
  }).slice(0, 30);
  return { valid: true, alerts };
}

export function parseTransitAlerts(payload: unknown, now = Date.now()): AlertFeedParse {
  const gtfs = gtfsAlerts(payload, now);
  return gtfs.valid ? gtfs : siriAlerts(payload, now);
}

export function matchTransitAlerts(
  alerts: TransitFeedAlert[],
  routes: Array<{ routeId: string | null; routeNumber: string | null; routeName: string | null }>,
  stops: Array<{ id: string; name: string }>,
  fetchedAt: string,
): JourneyAlert[] {
  const normalize = (value: string) => value.trim().toLowerCase();
  return alerts.flatMap((alert) => {
    const routeRefs = new Set(alert.routeRefs.map(normalize));
    const stopRefs = new Set(alert.stopRefs.map(normalize));
    const routeMatches = routes.filter((route) =>
      [route.routeId, route.routeNumber, route.routeName]
        .some((ref) => !!ref && routeRefs.has(normalize(ref))),
    );
    const stopMatches = stops.filter((stop) => stopRefs.has(normalize(stop.id)));
    if (!routeMatches.length && !stopMatches.length && (routeRefs.size > 0 || stopRefs.size > 0)) return [];
    const impact = routeMatches.length && stopMatches.length
      ? "route_and_stop_match"
      : routeMatches.length
        ? "route_match"
        : stopMatches.length
          ? "stop_match"
          : "uncertain";
    return [{
      providerId: alert.providerId,
      originalText: alert.originalText,
      status: alert.status,
      activePeriods: alert.activePeriods,
      routeMatches,
      stopMatches,
      impact,
      source: alert.source,
      fetchedAt,
    }];
  });
}