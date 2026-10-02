import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import {
  setBaseUrl,
  updateTrackingLocation,
} from "@workspace/api-client-react";

export const LIVE_LOCATION_TASK = "pathpal-live-journey-location";
export const ACTIVE_TRACKING_SESSION_KEY = "pathpal-live-journey-session-v1";

interface StoredTrackingSession {
  journeyId: string;
  token: string;
  expiresAt: string;
}

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

function isSessionEnded(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in error &&
      ((error as { status?: unknown }).status === 401 ||
        (error as { status?: unknown }).status === 410),
  );
}

async function stopLocalTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
  }
  await SecureStore.deleteItemAsync(ACTIVE_TRACKING_SESSION_KEY);
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LIVE_LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;

    let session: StoredTrackingSession | null = null;
    try {
      const stored = await SecureStore.getItemAsync(ACTIVE_TRACKING_SESSION_KEY);
      if (!stored) {
        await stopLocalTracking();
        return;
      }
      session = JSON.parse(stored) as StoredTrackingSession;
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        await stopLocalTracking();
        return;
      }

      const latest = data.locations.reduce((current, candidate) =>
        candidate.timestamp > current.timestamp ? candidate : current,
      );
      await updateTrackingLocation(
        session.journeyId,
        {
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
          accuracy: latest.coords.accuracy ?? 10_000,
          capturedAt: new Date(latest.timestamp).toISOString(),
        },
        { headers: { Authorization: `Bearer ${session.token}` } },
      );
    } catch (requestError) {
      if (isSessionEnded(requestError)) {
        await stopLocalTracking();
      }
    }
  },
);