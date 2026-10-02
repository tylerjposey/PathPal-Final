export type MapProvider = "google" | "apple";
export type MapPlatform = "ios" | "android" | "other";
export type MapTravelMode = "walking" | "transit";

export type MapDirectionsTarget = {
  mode: MapTravelMode;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
};

export type MapCoordinates = { lat: number; lng: number };

export type MapDirectionsResult =
  | { ok: true; url: string; usedBrowserFallback: boolean }
  | { ok: false; url?: string; message: string };

type MapDirectionsHandoff = {
  provider: MapProvider;
  target: MapDirectionsTarget | null;
  platform: MapPlatform;
  openURL: (url: string) => Promise<unknown>;
  openBrowser?: (url: string) => Promise<unknown>;
};

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
}

export function createSelectedRouteMapTarget(
  mode: MapTravelMode,
  origin: MapCoordinates | null,
  destination: MapCoordinates | null,
): MapDirectionsTarget | null {
  if (
    !origin ||
    !destination ||
    !isValidCoordinate(origin.lat, origin.lng) ||
    !isValidCoordinate(destination.lat, destination.lng)
  ) {
    return null;
  }

  return {
    mode,
    origin: { latitude: origin.lat, longitude: origin.lng },
    destination: { latitude: destination.lat, longitude: destination.lng },
  };
}

export function createSavedJourneyMapTarget(journey: {
  mode: MapTravelMode;
  originLatitude?: number | null;
  originLongitude?: number | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
}): MapDirectionsTarget | null {
  if (
    journey.originLatitude == null ||
    journey.originLongitude == null ||
    journey.destinationLatitude == null ||
    journey.destinationLongitude == null ||
    !isValidCoordinate(journey.originLatitude, journey.originLongitude) ||
    !isValidCoordinate(journey.destinationLatitude, journey.destinationLongitude)
  ) {
    return null;
  }

  return {
    mode: journey.mode,
    origin: {
      latitude: journey.originLatitude,
      longitude: journey.originLongitude,
    },
    destination: {
      latitude: journey.destinationLatitude,
      longitude: journey.destinationLongitude,
    },
  };
}

export function buildMapDirectionsUrl(
  provider: MapProvider,
  target: MapDirectionsTarget,
): string | null {
  if (
    !isValidCoordinate(target.origin.latitude, target.origin.longitude) ||
    !isValidCoordinate(target.destination.latitude, target.destination.longitude)
  ) {
    return null;
  }

  const origin = `${target.origin.latitude},${target.origin.longitude}`;
  const destination = `${target.destination.latitude},${target.destination.longitude}`;
  const params = new URLSearchParams();

  if (provider === "google") {
    params.set("api", "1");
    params.set("origin", origin);
    params.set("destination", destination);
    params.set("travelmode", target.mode === "walking" ? "walking" : "transit");
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  params.set("saddr", origin);
  params.set("daddr", destination);
  params.set("dirflg", target.mode === "walking" ? "w" : "r");
  return `https://maps.apple.com/?${params.toString()}`;
}

export async function openMapDirections({
  provider,
  target,
  platform,
  openURL,
  openBrowser,
}: MapDirectionsHandoff): Promise<MapDirectionsResult> {
  if (!target) {
    return {
      ok: false,
      message: "Route coordinates are unavailable. Find and select the route again.",
    };
  }

  const url = buildMapDirectionsUrl(provider, target);
  if (!url) {
    return {
      ok: false,
      message: "Route coordinates are unavailable. Find and select the route again.",
    };
  }

  try {
    await openURL(url);
    return { ok: true, url, usedBrowserFallback: false };
  } catch {
    if (provider === "apple" && platform === "android" && openBrowser) {
      try {
        await openBrowser(url);
        return { ok: true, url, usedBrowserFallback: true };
      } catch {
        // The explicit browser fallback also failed; return a user-visible error below.
      }
    }

    return {
      ok: false,
      url,
      message: `Could not open ${provider === "google" ? "Google Maps" : "Apple Maps"}. Try opening the link in a browser.`,
    };
  }
}