import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleTransitRoute,
  choosePreferredTransitRoutes,
  dedupeGoogleTransitRoutes,
  filterVtaBusRoutes,
  parseGoogleRoute,
  shouldUseGoogleTransitFallback,
} from "../src/routes/journey";
import { findVtaJourneys } from "../src/routes/vta-gtfs";

const busStepPolyline = "oq{bFnz|fVgEgE";

function parsedVtaRoute({
  id = "google-route-1",
  durationMinutes = 18,
  routeNumber = "22",
  boardingId = "vta-stop-a",
  alightingId = "vta-stop-b",
  polyline = busStepPolyline,
  agencyNames = ["Santa Clara Valley Transportation Authority"],
  vehicleType = "BUS",
} = {}) {
  return {
    route: {
      id,
      name: `VTA route ${routeNumber}`,
      startStop: "Diridon",
      destinationStop: "Downtown",
      durationMinutes,
      walkingMeters: 120,
      transfers: 0,
      delayMinutes: 0,
      alerts: [],
      available: true,
      recommended: false,
      source: "live",
      mode: "transit",
      legs: [],
      polyline: "overview-polyline-is-not-the-bus-step",
    },
    lineRefs: [routeNumber],
    legStops: [{
      type: "bus",
      boarding: { id: boardingId, name: "Diridon", lat: 37.329, lng: -121.902 },
      alighting: { id: alightingId, name: "Downtown", lat: 37.338, lng: -121.886 },
      distanceMeters: 1_400,
      durationMinutes: 10,
      polyline,
      routeNumber,
      routeName: `VTA ${routeNumber}`,
      scheduledDeparture: undefined,
      vehicleType,
      agencyNames,
    }],
  };
}

function journeyRoute(id, name) {
  return {
    id,
    name,
    startStop: "Diridon",
    destinationStop: "Downtown",
    durationMinutes: 20,
    walkingMeters: 100,
    transfers: 0,
    delayMinutes: 0,
    alerts: [],
    available: true,
    recommended: false,
    source: "live",
    mode: "transit",
    legs: [],
  };
}

function syntheticGtfsFeed(includeShape) {
  const boarding = {
    id: "stop-a",
    name: "Diridon",
    lat: 37.329,
    lng: -121.902,
  };
  const alighting = {
    id: "stop-b",
    name: "Downtown",
    lat: 37.338,
    lng: -121.886,
  };
  const trip = {
    routeId: "route-22",
    shapeId: "shape-22",
    stops: [
      { id: boarding.id, arrival: 36_000, departure: 36_000, shapeDistance: 0 },
      { id: alighting.id, arrival: 36_900, departure: 36_900, shapeDistance: 2 },
    ],
  };
  const points = [
    { lat: 37.329, lng: -121.902, distance: 0, sequence: 0 },
    { lat: 37.333, lng: -121.894, distance: 1, sequence: 1 },
    { lat: 37.338, lng: -121.886, distance: 2, sequence: 2 },
  ];

  return {
    stops: new Map([[boarding.id, boarding], [alighting.id, alighting]]),
    routes: new Map([["route-22", { number: "22", name: "VTA 22" }]]),
    trips: new Map([["trip-22", trip]]),
    byStop: new Map([[
      boarding.id,
      [{ tripId: "trip-22", index: 0, departure: trip.stops[0].departure }],
    ]]),
    shapes: new Map(includeShape ? [[trip.shapeId, points]] : []),
    serviceDate: "20261002",
    secondsNow: 32_400,
    dayStartMs: 0,
  };
}

test("Google Transit parsing preserves a verified VTA bus-step polyline and labels the route", () => {
  const parsed = parseGoogleRoute({
    duration: "1200s",
    polyline: { encodedPolyline: "google-overview-polyline" },
    legs: [{
      steps: [{
        travelMode: "TRANSIT",
        startLocation: { latLng: { latitude: 37.329, longitude: -121.902 } },
        endLocation: { latLng: { latitude: 37.338, longitude: -121.886 } },
        distanceMeters: 1_400,
        staticDuration: "600s",
        polyline: { encodedPolyline: busStepPolyline },
        transitDetails: {
          stopDetails: {
            departureStop: {
              name: "Diridon",
              location: { latLng: { latitude: 37.329, longitude: -121.902 } },
            },
            arrivalStop: {
              name: "Downtown",
              location: { latLng: { latitude: 37.338, longitude: -121.886 } },
            },
            departureTime: "2026-10-02T08:00:00-07:00",
          },
          transitLine: {
            nameShort: "22",
            name: "VTA 22",
            vehicle: { type: "BUS" },
            agencies: [{ name: "Santa Clara Valley Transportation Authority" }],
          },
        },
      }],
    }],
  }, 0);
  assert.ok(parsed);
  const [verified] = filterVtaBusRoutes([parsed], undefined);
  assert.ok(verified);

  const route = buildGoogleTransitRoute(verified, undefined);
  assert.match(route.name, /^Google Transit · /);
  assert.equal(route.legs[0].type, "bus");
  assert.equal(route.legs[0].polyline, busStepPolyline);
});

test("Google Transit fallback rejects other agencies and non-bus vehicles", () => {
  const catalog = { lines: [{ name: "VTA 22", refs: ["22"] }] };
  const nonVta = parsedVtaRoute({ agencyNames: ["Caltrain"] });
  const nonBus = parsedVtaRoute({ vehicleType: "RAIL" });

  assert.deepEqual(filterVtaBusRoutes([nonVta, nonBus], catalog), []);
});

test("a 511 schedule route suppresses Google fallback and remains the preferred transit choice", () => {
  const scheduleRoute = journeyRoute("vta-schedule-1", "511 VTA schedule");
  const googleRoute = journeyRoute("google-route-1", "Google Transit · VTA 22");

  assert.equal(shouldUseGoogleTransitFallback("any", [scheduleRoute]), false);
  assert.equal(shouldUseGoogleTransitFallback("transit", []), true);
  assert.equal(shouldUseGoogleTransitFallback("walking", []), false);
  assert.deepEqual(
    choosePreferredTransitRoutes([scheduleRoute], [googleRoute]),
    [scheduleRoute],
  );
  assert.deepEqual(choosePreferredTransitRoutes([], [googleRoute]), [googleRoute]);
});

test("duplicate Google alternatives collapse by bus itinerary and retain verified geometry", () => {
  const withoutGeometry = parsedVtaRoute({
    id: "google-route-a",
    durationMinutes: 15,
    polyline: null,
  });
  const withGeometry = parsedVtaRoute({
    id: "google-route-b",
    durationMinutes: 18,
    polyline: busStepPolyline,
  });
  const anotherItinerary = parsedVtaRoute({
    id: "google-route-c",
    routeNumber: "23",
    boardingId: "different-stop-a",
    alightingId: "different-stop-b",
  });

  const unique = dedupeGoogleTransitRoutes([
    withoutGeometry,
    withGeometry,
    anotherItinerary,
  ]);

  assert.equal(unique.length, 2);
  assert.equal(unique.find((route) => route.route.id === "google-route-b")?.legStops[0].polyline, busStepPolyline);
  assert.ok(unique.some((route) => route.route.id === "google-route-c"));
});

test("a GTFS ride without an established provider shape keeps null geometry", () => {
  const [journey] = findVtaJourneys(
    syntheticGtfsFeed(false),
    { lat: 37.329, lng: -121.902 },
    { lat: 37.338, lng: -121.886 },
  );

  assert.ok(journey);
  assert.equal(journey.rides[0].polyline, null);
});

test("a GTFS ride uses the ordered operator shape when its stop-distance segment is available", () => {
  const [journey] = findVtaJourneys(
    syntheticGtfsFeed(true),
    { lat: 37.329, lng: -121.902 },
    { lat: 37.338, lng: -121.886 },
  );

  assert.ok(journey);
  assert.ok(journey.rides[0].polyline);
});