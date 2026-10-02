import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMapDirectionsUrl,
  createSavedJourneyMapTarget,
  createSelectedRouteMapTarget,
  openMapDirections,
} from "../lib/map-directions.ts";

const selectedRoute = createSelectedRouteMapTarget(
  "transit",
  { lat: 37.3382, lng: -121.8863 },
  { lat: 37.3496, lng: -121.939 },
);
assert.ok(selectedRoute);

const previouslySavedRoute = createSavedJourneyMapTarget({
  mode: "walking",
  originLatitude: 37.3331,
  originLongitude: -121.8902,
  destinationLatitude: 37.3467,
  destinationLongitude: -121.9214,
});
assert.ok(previouslySavedRoute);

function assertDirectionsParams(provider, url, target) {
  const parsed = new URL(url);
  const origin = `${target.origin.latitude},${target.origin.longitude}`;
  const destination = `${target.destination.latitude},${target.destination.longitude}`;

  if (provider === "google") {
    assert.equal(parsed.origin, "https://www.google.com");
    assert.equal(parsed.pathname, "/maps/dir/");
    assert.equal(parsed.searchParams.get("api"), "1");
    assert.equal(parsed.searchParams.get("origin"), origin);
    assert.equal(parsed.searchParams.get("destination"), destination);
    assert.equal(parsed.searchParams.get("travelmode"), target.mode);
  } else {
    assert.equal(parsed.origin, "https://maps.apple.com");
    assert.equal(parsed.searchParams.get("saddr"), origin);
    assert.equal(parsed.searchParams.get("daddr"), destination);
    assert.equal(parsed.searchParams.get("dirflg"), target.mode === "walking" ? "w" : "r");
  }
}

test("a just-selected transit route hands its coordinates and mode to iOS map links", async () => {
  for (const provider of ["google", "apple"]) {
    let openedUrl;
    const result = await openMapDirections({
      provider,
      target: selectedRoute,
      platform: "ios",
      openURL: async (url) => { openedUrl = url; },
    });

    assert.equal(result.ok, true);
    assert.equal(result.usedBrowserFallback, false);
    assert.equal(openedUrl, buildMapDirectionsUrl(provider, selectedRoute));
    assertDirectionsParams(provider, openedUrl, selectedRoute);
  }
});

test("a previously saved walking route hands its stored coordinates and mode to iOS map links", async () => {
  for (const provider of ["google", "apple"]) {
    let openedUrl;
    const result = await openMapDirections({
      provider,
      target: previouslySavedRoute,
      platform: "ios",
      openURL: async (url) => { openedUrl = url; },
    });

    assert.equal(result.ok, true);
    assert.equal(result.usedBrowserFallback, false);
    assert.equal(openedUrl, buildMapDirectionsUrl(provider, previouslySavedRoute));
    assertDirectionsParams(provider, openedUrl, previouslySavedRoute);
  }
});

test("Android hands Google directions to the system map URL handler", async () => {
  const openedUrls = [];
  const browserUrls = [];
  const result = await openMapDirections({
    provider: "google",
    target: selectedRoute,
    platform: "android",
    openURL: async (url) => { openedUrls.push(url); },
    openBrowser: async (url) => { browserUrls.push(url); },
  });

  assert.equal(result.ok, true);
  assert.equal(openedUrls.length, 1);
  assertDirectionsParams("google", openedUrls[0], selectedRoute);
  assert.deepEqual(browserUrls, []);
});

test("Android retries Apple Maps directions in a browser and returns a clear error if that fails", async () => {
  const browserUrls = [];
  const result = await openMapDirections({
    provider: "apple",
    target: previouslySavedRoute,
    platform: "android",
    openURL: async () => { throw new Error("No URL handler"); },
    openBrowser: async (url) => { browserUrls.push(url); },
  });

  assert.equal(result.ok, true);
  assert.equal(result.usedBrowserFallback, true);
  assertDirectionsParams("apple", browserUrls[0], previouslySavedRoute);

  const failed = await openMapDirections({
    provider: "apple",
    target: previouslySavedRoute,
    platform: "android",
    openURL: async () => { throw new Error("No URL handler"); },
    openBrowser: async () => { throw new Error("No browser"); },
  });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /Could not open Apple Maps/);
  assert.match(failed.message, /browser/);
});

test("invalid route coordinates produce a clear result without attempting a handoff", async () => {
  let openAttempts = 0;
  const result = await openMapDirections({
    provider: "google",
    target: {
      ...selectedRoute,
      origin: { latitude: Number.NaN, longitude: -121.8863 },
    },
    platform: "android",
    openURL: async () => { openAttempts += 1; },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /coordinates are unavailable/);
  assert.equal(openAttempts, 0);
});