import { unzipSync } from "fflate";
import { parse } from "csv-parse/sync";

const FEED_URL = "https://api.511.org/transit/datafeeds";
const FEED_TTL_MS = 6 * 60 * 60_000;
const FAILURE_TTL_MS = 60_000;
const ZONE = "America/Los_Angeles";

export type GtfsStop = { id: string; name: string; lat: number; lng: number };
export type GtfsRide = {
  routeId: string;
  routeNumber: string;
  routeName: string;
  boarding: GtfsStop;
  alighting: GtfsStop;
  departure: number;
  arrival: number;
  distanceMeters: number;
  polyline: string | null;
};
export type GtfsJourney = {
  rides: GtfsRide[];
  walkingMeters: number;
  durationMinutes: number;
  originWalkMinutes: number;
  destinationWalkMinutes: number;
};

type CsvRow = Record<string, string>;
type Trip = { routeId: string; shapeId: string; stops: TripStop[] };
type TripStop = { id: string; arrival: number; departure: number; shapeDistance: number };
type Event = { tripId: string; index: number; departure: number };
type ShapePoint = { lat: number; lng: number; distance: number };
export type Feed = {
  stops: Map<string, GtfsStop>;
  routes: Map<string, { number: string; name: string }>;
  trips: Map<string, Trip>;
  byStop: Map<string, Event[]>;
  shapes: Map<string, ShapePoint[]>;
  serviceDate: string;
  secondsNow: number;
  dayStartMs: number;
};
let feedCache: { value: Feed; expiresAt: number } | undefined;
let inFlight: Promise<Feed | undefined> | undefined;
let failureExpiresAt = 0;

function localClock(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const serviceDate = `${parts.year}${parts.month}${parts.day}`;
  const secondsNow = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const dayOfWeek = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`).getUTCDay();
  return { serviceDate, secondsNow, dayOfWeek, dayStartMs: now.getTime() - secondsNow * 1000 };
}

function csv(files: Record<string, Uint8Array>, name: string): CsvRow[] {
  const file = files[`${name}.txt`];
  if (!file) throw new Error("Incomplete GTFS feed");
  return parse(Buffer.from(file).toString("utf8"), { columns: true, skip_empty_lines: true, bom: true }) as CsvRow[];
}

function seconds(value: string): number {
  const parts = value.split(":").map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : NaN;
}

function prepareFeed(bytes: Uint8Array, now: Date): Feed {
  const files = unzipSync(bytes);
  const clock = localClock(now);
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const active = new Set(csv(files, "calendar")
    .filter((row) =>
      row.start_date <= clock.serviceDate &&
      row.end_date >= clock.serviceDate &&
      row[days[clock.dayOfWeek]] === "1")
    .map((row) => row.service_id));
  for (const row of csv(files, "calendar_dates")) {
    if (row.date !== clock.serviceDate) continue;
    if (row.exception_type === "1") active.add(row.service_id);
    if (row.exception_type === "2") active.delete(row.service_id);
  }
  const routes = new Map(csv(files, "routes")
    .filter((row) => row.route_type === "3" && row.agency_id === "SC")
    .map((row) => [row.route_id, { number: row.route_short_name, name: row.route_long_name }]));
  const stops = new Map(csv(files, "stops").map((row) => [
    row.stop_id, { id: row.stop_id, name: row.stop_name, lat: Number(row.stop_lat), lng: Number(row.stop_lon) },
  ] as const));
  const trips = new Map<string, Trip>();
  for (const row of csv(files, "trips")) {
    if (!active.has(row.service_id) || !routes.has(row.route_id)) continue;
    trips.set(row.trip_id, { routeId: row.route_id, shapeId: row.shape_id, stops: [] });
  }
  const byStop = new Map<string, Event[]>();
  for (const row of csv(files, "stop_times")) {
    const trip = trips.get(row.trip_id);
    if (!trip || !stops.has(row.stop_id)) continue;
    const departure = seconds(row.departure_time);
    const arrival = seconds(row.arrival_time);
    if (!Number.isFinite(departure) || !Number.isFinite(arrival)) continue;
    const index = trip.stops.length;
    trip.stops.push({
      id: row.stop_id, arrival, departure,
      shapeDistance: Number(row.shape_dist_traveled),
    });
    const events = byStop.get(row.stop_id) ?? [];
    events.push({ tripId: row.trip_id, index, departure });
    byStop.set(row.stop_id, events);
  }
  for (const events of byStop.values()) events.sort((a, b) => a.departure - b.departure);
  // Keep only the shapes in today's active service; GTFS shapes contain the
  // actual operator-supplied bus geometry, not straight-line approximations.
  const activeShapes = new Set([...trips.values()].map((trip) => trip.shapeId));
  const shapes = new Map<string, ShapePoint[]>();
  for (const row of csv(files, "shapes")) {
    if (!activeShapes.has(row.shape_id)) continue;
    const points = shapes.get(row.shape_id) ?? [];
    points.push({
      lat: Number(row.shape_pt_lat), lng: Number(row.shape_pt_lon),
      distance: Number(row.shape_dist_traveled),
    });
    shapes.set(row.shape_id, points);
  }
  return { routes, stops, trips, byStop, shapes, ...clock };
}

export async function getVtaGtfs(): Promise<Feed | undefined> {
  const key = process.env.TRANSIT_511_API_KEY;
  if (!key) return undefined;
  const now = new Date();
  const date = localClock(now).serviceDate;
  if (feedCache?.expiresAt && feedCache.expiresAt > now.getTime() && feedCache.value.serviceDate === date) {
    return { ...feedCache.value, secondsNow: localClock(now).secondsNow, dayStartMs: localClock(now).dayStartMs };
  }
  if (failureExpiresAt > now.getTime()) return undefined;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const url = new URL(FEED_URL);
      url.searchParams.set("api_key", key);
      url.searchParams.set("operator_id", "SC");
      const response = await fetch(url, { signal: AbortSignal.timeout(35_000) });
      if (!response.ok) throw new Error("VTA feed unavailable");
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > 40_000_000) throw new Error("VTA feed too large");
      const feed = prepareFeed(buffer, new Date());
      if (!feed.trips.size || !feed.stops.size) throw new Error("Empty VTA schedule");
      feedCache = { value: feed, expiresAt: Date.now() + FEED_TTL_MS };
      failureExpiresAt = 0;
      return feed;
    } catch {
      // Do not log request URLs or upstream errors: URLs contain the API key.
      failureExpiresAt = Date.now() + FAILURE_TTL_MS;
      return undefined;
    } finally {
      inFlight = undefined;
    }
  })();
  return inFlight;
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const deltaLat = rad(b.lat - a.lat);
  const deltaLng = rad(b.lng - a.lng);
  const h = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(12_742_000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function encodePolyline(points: ShapePoint[]): string | null {
  if (points.length < 2) return null;
  let lastLat = 0, lastLng = 0, encoded = "";
  const encode = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 0x20) {
      encoded += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    encoded += String.fromCharCode(value + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    encode(lat - lastLat);
    encode(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return encoded;
}

function makeRide(feed: Feed, tripId: string, from: number, to: number): GtfsRide | undefined {
  const trip = feed.trips.get(tripId);
  if (!trip) return undefined;
  const start = trip.stops[from], end = trip.stops[to];
  const boarding = feed.stops.get(start.id), alighting = feed.stops.get(end.id);
  const route = feed.routes.get(trip.routeId);
  if (!boarding || !alighting || !route || to <= from) return undefined;
  const shape = feed.shapes.get(trip.shapeId) ?? [];
  const points = Number.isFinite(start.shapeDistance) && Number.isFinite(end.shapeDistance)
    ? shape.filter((point) => point.distance >= start.shapeDistance && point.distance <= end.shapeDistance)
    : [];
  return {
    routeId: trip.routeId, routeNumber: route.number, routeName: route.name,
    boarding, alighting, departure: start.departure, arrival: end.arrival,
    distanceMeters: Number.isFinite(end.shapeDistance - start.shapeDistance)
      ? Math.round((end.shapeDistance - start.shapeDistance) * 1000)
      : distance(boarding, alighting),
    polyline: encodePolyline(points),
  };
}

export function findVtaJourneys(
  feed: Feed, origin: { lat: number; lng: number }, destination: { lat: number; lng: number },
): GtfsJourney[] {
  const nearest = (coordinate: { lat: number; lng: number }, maxMeters: number, limit: number) =>
    [...feed.stops.values()]
      .map((stop) => ({ stop, meters: distance(coordinate, stop) }))
      .filter((item) => item.meters <= maxMeters)
      .sort((a, b) => a.meters - b.meters)
      .slice(0, limit);
  const originStops = nearest(origin, 800, 8);
  const destinationStops = nearest(destination, 900, 12);
  const targets = new Map(destinationStops.map(({ stop, meters }) => [stop.id, meters]));
  const found: GtfsJourney[] = [];
  const dedupe = new Set<string>();
  const build = (first: GtfsRide, second: GtfsRide | undefined, accessMeters: number, exitMeters: number) => {
    const rides = second ? [first, second] : [first];
    const key = rides.map((ride) => `${ride.routeId}:${ride.boarding.id}:${ride.alighting.id}`).join(":");
    if (dedupe.has(key)) return;
    dedupe.add(key);
    const walkingMeters = accessMeters + exitMeters;
    found.push({
      rides, walkingMeters, originWalkMinutes: Math.ceil(accessMeters / 75),
      destinationWalkMinutes: Math.ceil(exitMeters / 75),
      durationMinutes: Math.ceil((rides[rides.length - 1].arrival - feed.secondsNow) / 60) +
        Math.ceil(exitMeters / 75),
    });
  };
  for (const { stop: originStop, meters: access } of originStops) {
    const startAfter = feed.secondsNow + Math.ceil(access / 75) * 60;
    const departures = (feed.byStop.get(originStop.id) ?? [])
      .filter((event) => event.departure >= startAfter && event.departure <= feed.secondsNow + 2 * 3600)
      .slice(0, 28);
    for (const event of departures) {
      const firstTrip = feed.trips.get(event.tripId);
      if (!firstTrip) continue;
      for (let i = event.index + 1; i < firstTrip.stops.length; i++) {
        const at = firstTrip.stops[i];
        const targetMeters = targets.get(at.id);
        if (targetMeters !== undefined) {
          const ride = makeRide(feed, event.tripId, event.index, i);
          if (ride) build(ride, undefined, access, targetMeters);
        }
        if (found.length > 150 || i - event.index > 65) break;
        // Consider at most a few departures at each possible transfer stop.
        const transfers = (feed.byStop.get(at.id) ?? [])
          .filter((next) => next.tripId !== event.tripId &&
            next.departure >= at.arrival + 180 &&
            next.departure <= at.arrival + 35 * 60)
          .slice(0, 3);
        for (const next of transfers) {
          const nextTrip = feed.trips.get(next.tripId);
          if (!nextTrip || nextTrip.routeId === firstTrip.routeId) continue;
          for (let j = next.index + 1; j < nextTrip.stops.length; j++) {
            const exit = targets.get(nextTrip.stops[j].id);
            if (exit === undefined) continue;
            const first = makeRide(feed, event.tripId, event.index, i);
            const second = makeRide(feed, next.tripId, next.index, j);
            if (first && second) build(first, second, access, exit);
          }
        }
      }
    }
  }
  return found
    .filter((journey) => journey.durationMinutes > 0 && journey.durationMinutes < 240)
    .sort((a, b) => a.durationMinutes + a.rides.length * 7 + a.walkingMeters / 100 -
      (b.durationMinutes + b.rides.length * 7 + b.walkingMeters / 100))
    .slice(0, 5);
}

export function scheduledTimestamp(feed: Feed, secondsAfterMidnight: number): string {
  return new Date(feed.dayStartMs + secondsAfterMidnight * 1000).toISOString();
}