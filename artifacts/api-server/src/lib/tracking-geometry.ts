import type { TrackingRoute } from "@workspace/api-zod";

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface RoutePosition {
  distanceFromRoute: number;
  progressMeters: number;
  routeMeters: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

export function decodePolyline(encoded: string): Coordinate[] {
  if (encoded.length < 2 || encoded.length > 200_000) {
    throw new Error("Invalid provider route geometry.");
  }

  const points: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const decodeValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length || shift > 30) {
        throw new Error("Invalid provider route geometry.");
      }
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error("Invalid provider route geometry.");
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return (result & 1) ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    latitude += decodeValue();
    longitude += decodeValue();
    const point = { lat: latitude / 100_000, lng: longitude / 100_000 };
    if (
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lng) ||
      Math.abs(point.lat) > 90 ||
      Math.abs(point.lng) > 180
    ) {
      throw new Error("Invalid provider route geometry.");
    }
    points.push(point);
  }

  if (points.length < 2) throw new Error("Provider route geometry is incomplete.");
  return points;
}

function distanceMeters(a: Coordinate, b: Coordinate): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const latA = toRadians(a.lat);
  const latB = toRadians(b.lat);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function routePoints(route: TrackingRoute): Coordinate[] {
  const points: Coordinate[] = [];
  for (const leg of route.legs) {
    for (const point of decodePolyline(leg.polyline)) {
      const previous = points[points.length - 1];
      if (!previous || distanceMeters(previous, point) > 1) points.push(point);
    }
  }
  if (points.length < 2) throw new Error("Provider route geometry is incomplete.");
  return points;
}

export function measureRoute(route: TrackingRoute): number {
  const points = routePoints(route);
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceMeters(points[index - 1], points[index]);
  }
  if (!Number.isFinite(total) || total < 10) {
    throw new Error("Provider route geometry is too short to track.");
  }
  return total;
}

export function matchRoutePosition(
  route: TrackingRoute,
  location: Coordinate,
): RoutePosition {
  const points = routePoints(route);
  const segmentLengths: number[] = [];
  let routeMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = distanceMeters(points[index - 1], points[index]);
    segmentLengths.push(length);
    routeMeters += length;
  }

  let progressBeforeSegment = 0;
  let best: RoutePosition | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const meanLatitude = ((start.lat + end.lat + location.lat) / 3) * Math.PI / 180;
    const scaleX = 111_320 * Math.cos(meanLatitude);
    const scaleY = 110_540;
    const ax = start.lng * scaleX;
    const ay = start.lat * scaleY;
    const bx = end.lng * scaleX;
    const by = end.lat * scaleY;
    const px = location.lng * scaleX;
    const py = location.lat * scaleY;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    const nearest = { lat: start.lat + (end.lat - start.lat) * t, lng: start.lng + (end.lng - start.lng) * t };
    const candidate: RoutePosition = {
      distanceFromRoute: distanceMeters(location, nearest),
      progressMeters: progressBeforeSegment + segmentLengths[index - 1] * t,
      routeMeters,
    };
    if (!best || candidate.distanceFromRoute < best.distanceFromRoute) best = candidate;
    progressBeforeSegment += segmentLengths[index - 1];
  }

  if (!best || routeMeters < 10) throw new Error("Provider route geometry is incomplete.");
  return { ...best, routeMeters };
}

export function distanceBetween(a: Coordinate, b: Coordinate): number {
  return distanceMeters(a, b);
}