import {
  correctTrackingArrival,
  createTrackingJourney,
  endTrackingJourney,
  optInToTrackingJourney,
  recordTrackingCheckin,
  useGetTrackingProfile,
  type TrackingJourney,
  type TrackingProfileResponse,
  type TrackingRoute,
} from '@workspace/api-client-react';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, Card, SectionTitle } from '@/components/OrivisUI';
import { useColors } from '@/hooks/useColors';
import { useDemo, type SelectedJourney } from '@/context/DemoContext';
import { trackingProfileQueryKey } from '@/lib/reportApi';
import {
  ACTIVE_TRACKING_SESSION_KEY,
  LIVE_LOCATION_TASK,
} from '@/lib/locationTask';

type ManualCheckpoint = { key: string; label: string };

function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return error instanceof Error ? error.message : 'Live tracking could not be updated.';
}

function toTrackingRoute(journey: SelectedJourney | null): TrackingRoute | null {
  if (
    !journey ||
    journey.source !== 'live' ||
    !Number.isFinite(journey.originLatitude) ||
    !Number.isFinite(journey.originLongitude) ||
    !Number.isFinite(journey.destinationLatitude) ||
    !Number.isFinite(journey.destinationLongitude) ||
    !Array.isArray(journey.legs) ||
    journey.legs.length === 0
  ) {
    return null;
  }

  const legs = [];
  for (const leg of journey.legs) {
    if (
      !leg.polyline ||
      !Number.isFinite(leg.boardingStop.lat) ||
      !Number.isFinite(leg.boardingStop.lng) ||
      !Number.isFinite(leg.alightingStop.lat) ||
      !Number.isFinite(leg.alightingStop.lng)
    ) {
      return null;
    }
    legs.push({
      type: leg.type,
      routeNumber: leg.routeNumber,
      routeName: leg.routeName,
      boardingStop: {
        name: leg.boardingStop.name,
        lat: leg.boardingStop.lat!,
        lng: leg.boardingStop.lng!,
      },
      alightingStop: {
        name: leg.alightingStop.name,
        lat: leg.alightingStop.lat!,
        lng: leg.alightingStop.lng!,
      },
      durationMinutes: leg.durationMinutes,
      delayMinutes: leg.delayMinutes,
      polyline: leg.polyline,
    });
  }

  return {
    routeId: journey.id,
    name: journey.name,
    startStop: journey.startStop,
    destinationStop: journey.destinationStop,
    destination: journey.destination,
    originName: journey.startingLocation || journey.startStop,
    originLatitude: journey.originLatitude!,
    originLongitude: journey.originLongitude!,
    destinationLatitude: journey.destinationLatitude!,
    destinationLongitude: journey.destinationLongitude!,
    source: 'live',
    mode: journey.mode,
    durationMinutes: Math.max(1, journey.durationMinutes),
    legs,
  };
}

function manualCheckpoints(route: TrackingRoute): ManualCheckpoint[] {
  if (route.mode === 'walking') {
    return [
      { key: 'walk-start', label: 'I started walking' },
      { key: 'walk-end', label: 'I reached the destination' },
    ];
  }
  const checkpoints: ManualCheckpoint[] = [];
  route.legs.forEach((leg, index) => {
    const last = index === route.legs.length - 1;
    if (leg.type === 'walk') {
      checkpoints.push({
        key: `leg-${index}-walk`,
        label: last ? 'I finished the walk' : 'I walked to the next stop',
      });
    } else {
      const bus = leg.routeNumber ? `Route ${leg.routeNumber}` : leg.routeName ?? 'the bus';
      checkpoints.push({ key: `leg-${index}-board`, label: `I boarded ${bus}` });
      checkpoints.push({ key: `leg-${index}-alight`, label: `I got off ${bus}` });
    }
  });
  if (route.legs.at(-1)?.type === 'bus') {
    checkpoints.push({ key: 'arrived', label: 'I reached the destination' });
  }
  return checkpoints;
}

function latestAutomaticEvent(profile: TrackingProfileResponse | null) {
  const automatic = profile?.journeys
    .flatMap((journey) => journey.events)
    .filter((event) => event.source === 'automatic')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return automatic?.[0];
}

async function beginJourneySharing(journeyId: string) {
  let foregroundGranted = false;
  let backgroundGranted = false;
  if (Platform.OS !== 'web') {
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      foregroundGranted = foreground.granted;
      if (foregroundGranted) {
        const background = await Location.requestBackgroundPermissionsAsync();
        backgroundGranted = background.granted;
      }
    } catch {
      foregroundGranted = false;
      backgroundGranted = false;
    }
  }

  const session = await optInToTrackingJourney(journeyId);
  if (Platform.OS !== 'web') {
    await SecureStore.setItemAsync(ACTIVE_TRACKING_SESSION_KEY, JSON.stringify(session));
  }

  if (Platform.OS !== 'web' && foregroundGranted) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
      }
      await Location.startLocationUpdatesAsync(LIVE_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 60_000,
        distanceInterval: 75,
        pausesUpdatesAutomatically: true,
        activityType: Location.ActivityType.Fitness,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'PathPal journey sharing is active',
          notificationBody: 'Location is used only for this active trip.',
        },
      });
      return {
        localLocationAvailable: true,
        message: backgroundGranted
          ? 'Location sharing is on for this journey.'
          : 'Location is available while the app is open. Allow Always access for background updates.',
      };
    } catch {
      return {
        localLocationAvailable: false,
        message: 'Location could not start. Manual check-ins are still available.',
      };
    }
  }

  return {
    localLocationAvailable: false,
    message: 'Location is unavailable. Manual check-ins are still available.',
  };
}

function ProfileJourneyCard({
  journey,
  profile,
  onChanged,
  selectedJourneyId,
}: {
  journey: TrackingJourney;
  profile: TrackingProfileResponse;
  onChanged: () => Promise<void>;
  selectedJourneyId: string | null;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [localLocationAvailable, setLocalLocationAvailable] = useState<boolean | null>(null);
  const route = journey.route;
  const checkpoints = useMemo(() => manualCheckpoints(route), [route]);
  const automaticArrival = journey.events.some(
    (event) => event.source === 'automatic' && event.checkpointKey.startsWith('arrival:') && !event.corrected,
  );

  const optIn = async () => {
    setBusy(true);
    setMessage('');
    let foregroundGranted = false;
    let backgroundGranted = false;
    try {
      if (Platform.OS !== 'web') {
        try {
          const foreground = await Location.requestForegroundPermissionsAsync();
          foregroundGranted = foreground.granted;
          if (foregroundGranted) {
            const background = await Location.requestBackgroundPermissionsAsync();
            backgroundGranted = background.granted;
          }
        } catch {
          foregroundGranted = false;
          backgroundGranted = false;
        }
      }

      const session = await optInToTrackingJourney(journey.id);
      if (Platform.OS !== 'web') {
        await SecureStore.setItemAsync(ACTIVE_TRACKING_SESSION_KEY, JSON.stringify(session));
      }
      if (Platform.OS !== 'web' && foregroundGranted) {
        try {
          if (await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK)) {
            await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
          }
          await Location.startLocationUpdatesAsync(LIVE_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 60_000,
            distanceInterval: 75,
            pausesUpdatesAutomatically: true,
            activityType: Location.ActivityType.Fitness,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'PathPal journey sharing is active',
              notificationBody: 'Location is used only for this approved trip.',
            },
          });
          setLocalLocationAvailable(true);
          setMessage(
            backgroundGranted
              ? 'Location sharing is on for this journey.'
              : 'Location is available while the app is open. Allow Always access for background updates.',
          );
        } catch {
          setLocalLocationAvailable(false);
          setMessage('Location could not start. Manual check-ins are still available.');
        }
      } else {
        setLocalLocationAvailable(false);
        setMessage('Location is unavailable. Manual check-ins are still available.');
      }
      await onChanged();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const stopSharing = async () => {
    setBusy(true);
    setMessage('');
    try {
      await endTrackingJourney(journey.id);
      if (Platform.OS !== 'web') {
        const stored = await SecureStore.getItemAsync(ACTIVE_TRACKING_SESSION_KEY);
        if (stored) {
          const session = JSON.parse(stored) as { journeyId?: string };
          if (session.journeyId === journey.id) {
          if (await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK)) {
            await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
          }
          await SecureStore.deleteItemAsync(ACTIVE_TRACKING_SESSION_KEY);
          }
        }
      }
      await onChanged();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const checkIn = async (checkpointKey: string) => {
    setBusy(true);
    setMessage('');
    try {
      await recordTrackingCheckin(journey.id, { checkpointKey });
      await onChanged();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const correctArrival = async () => {
    setBusy(true);
    setMessage('');
    try {
      await correctTrackingArrival(journey.id);
      await onChanged();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const progressColor = journey.locationHealth === 'stale' || journey.locationHealth === 'unavailable'
    ? colors.warning
    : journey.locationHealth === 'off_route'
      ? colors.destructive
      : colors.success;
  const statusText = journey.status === 'awaiting_child'
    ? 'Waiting for child consent'
    : journey.status === 'active'
      ? journey.locationHealth === 'stale'
        ? 'Location update is stale'
        : journey.locationHealth === 'unavailable'
          ? 'Location unavailable'
          : journey.locationHealth === 'off_route'
            ? 'Outside the selected route'
            : 'Sharing this journey'
      : journey.status === 'arrived'
        ? 'Arrival recorded'
        : journey.status === 'expired'
          ? 'Journey expired'
          : 'Sharing stopped';
  const isAssignedChild = profile.role === 'child';
  const canShare = isAssignedChild && journey.status === 'awaiting_child';
  const canCorrect = isAssignedChild && journey.status === 'arrived' && automaticArrival;
  const canEnd = journey.status === 'awaiting_child' || journey.status === 'active' || journey.status === 'arrived';
  const finalCheckpoints = checkpoints.filter((checkpoint) =>
    !journey.events.some((event) =>
      event.checkpointKey === checkpoint.key ||
      (checkpoint.key === 'arrived' || checkpoint.key === 'walk-end' ||
        checkpoint.key === `leg-${route.legs.length - 1}-walk`) &&
      event.checkpointKey.startsWith('arrival:') &&
      !event.corrected,
    ),
  );
  const isCurrentSelectedJourney = selectedJourneyId === route.routeId;

  return (
    <Card tone="soft" style={styles.journeyCard}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={[styles.journeyTitle, { color: colors.foreground }]}>{route.name}</Text>
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>
            {journey.childName} · {route.startStop} to {route.destinationStop}
          </Text>
        </View>
        {isCurrentSelectedJourney ? <Text style={[styles.selectedTag, { color: colors.primary }]}>Selected</Text> : null}
      </View>
      <View style={styles.progressMeta}>
        <Text style={[styles.status, { color: progressColor }]}>{statusText}</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>{journey.progressPercent}%</Text>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.progressFill, { backgroundColor: progressColor, width: `${journey.progressPercent}%` }]} />
      </View>
      <Text style={[styles.muted, { color: colors.mutedForeground }]}>
        {journey.locationHealth === 'stale' && journey.lastLocationAt
          ? `Last update ${new Date(journey.lastLocationAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : journey.locationHealth === 'unavailable'
            ? 'No usable location fix is being shared.'
            : 'Progress is matched to the selected provider route.'}
      </Text>

      {canShare ? (
        <>
          <Text style={[styles.privacyNote, { color: colors.mutedForeground }]}>
            Your parent enabled live tracking for the family. Starting is optional for this trip; exact location is not shown to the parent.
          </Text>
          <Button label="I agree — start sharing" icon="map-pin" onPress={() => { void optIn(); }} loading={busy} />
        </>
      ) : null}

      {isAssignedChild && journey.status === 'active' && finalCheckpoints.length ? (
        <View style={styles.checkinList}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Manual check-ins</Text>
          {finalCheckpoints.map((checkpoint) => (
            <Button
              key={checkpoint.key}
              label={checkpoint.label}
              icon="check-circle"
              variant="secondary"
              onPress={() => { void checkIn(checkpoint.key); }}
              disabled={busy}
            />
          ))}
        </View>
      ) : null}

      {canCorrect ? (
        <Button label="I have not arrived yet" icon="rotate-ccw" variant="secondary" onPress={() => { void correctArrival(); }} loading={busy} />
      ) : null}

      {canEnd ? (
        <Button
          label={journey.status === 'awaiting_child' ? 'Cancel this request' : 'Stop sharing'}
          icon="square"
          variant="danger"
          onPress={() => { void stopSharing(); }}
          loading={busy}
        />
      ) : null}

      {journey.events.length ? (
        <View style={styles.events}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Journey updates</Text>
          {journey.events.slice(-4).reverse().map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <View style={[styles.eventDot, { backgroundColor: event.corrected ? colors.warning : colors.primary }]} />
              <View style={styles.flex}>
                <Text style={[styles.eventTitle, { color: colors.foreground }]}>
                  {event.corrected ? `${event.title} · corrected` : event.title}
                </Text>
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>{event.subtitle}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {message ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.warning }]}>{message}</Text> : null}
      {localLocationAvailable === false && journey.status === 'active' && isAssignedChild ? (
        <Text style={[styles.muted, { color: colors.warning }]}>Manual check-ins remain available while location is off.</Text>
      ) : null}
    </Card>
  );
}

export function LiveTrackingPanel({ journey }: { journey: SelectedJourney | null }) {
  const colors = useColors();
  const { state } = useDemo();
  const profileQuery = useGetTrackingProfile({
    query: {
      queryKey: trackingProfileQueryKey(state.account),
      enabled: state.account?.role === 'child',
      refetchInterval: 20_000,
      retry: false,
    },
  });
  const profile = profileQuery.data ?? null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [checkpointNotice, setCheckpointNotice] = useState('');
  const seenEventId = useRef<string | null>(null);

  const refreshProfile = useCallback(async () => {
    await profileQuery.refetch();
  }, [profileQuery.refetch]);

  useEffect(() => {
    const latestEvent = latestAutomaticEvent(profile);
    if (seenEventId.current && latestEvent && latestEvent.id !== seenEventId.current) {
      setCheckpointNotice(`${latestEvent.title}: ${latestEvent.subtitle}`);
    }
    seenEventId.current = latestEvent?.id ?? seenEventId.current;
  }, [profile]);

  useEffect(() => {
    if (Platform.OS === 'web' || !profile) return;
    let cancelled = false;
    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync(ACTIVE_TRACKING_SESSION_KEY);
        if (!stored || cancelled) return;
        const session = JSON.parse(stored) as { journeyId?: string };
        const sharing = profile.journeys.some(
          (item) => item.id === session.journeyId && item.status === 'active',
        );
        if (sharing) return;
        if (await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK)) {
          await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
        }
        await SecureStore.deleteItemAsync(ACTIVE_TRACKING_SESSION_KEY);
      } catch (error) {
        if (!cancelled) setMessage(errorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [profile]);

  const routeForSharing = useMemo(() => toTrackingRoute(journey), [journey]);
  const activeJourney = profile?.journeys.find(
    (item) => item.status === 'active' || item.status === 'awaiting_child',
  );

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
      await refreshProfile();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const startCurrentJourney = async () => {
    if (!profile?.liveTrackingEnabled) {
      throw new Error('Ask your parent to enable live tracking in More.');
    }
    if (!routeForSharing) {
      throw new Error('Choose a live provider route with geometry before opting in.');
    }
    const child = profile.children[0];
    if (!child) throw new Error('Your child profile is not linked to this family.');

    const created = await createTrackingJourney({
      childId: child.id,
      route: routeForSharing,
    });
    const sharing = await beginJourneySharing(created.journey.id);
    setMessage(sharing.message);
  };

  if (profileQuery.isLoading && !profile) {
    return (
      <Card>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Live journey sharing</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading family settings…</Text>
      </Card>
    );
  }

  if (!profile) {
    const detail = errorStatus(profileQuery.error) === 404
      ? 'Your family is not set up for live tracking yet. Ask your parent to check Family in More.'
      : errorMessage(profileQuery.error);
    return (
      <Card>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Live journey sharing</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>{detail}</Text>
        <Button
          label="Retry"
          variant="secondary"
          onPress={() => { void profileQuery.refetch(); }}
          testID="retry-live-tracking-profile"
        />
      </Card>
    );
  }

  if (profile.role !== 'child') return null;

  return (
    <View style={styles.container}>
      <SectionTitle title="Live journey sharing" />
      <Card tone="soft">
        <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
          This uses your existing PathPal account. Sharing is optional for each trip; the parent sees route progress and checkpoints, never your exact location. The latest location is encrypted and cleared when sharing ends or expires.
        </Text>
      </Card>

      {checkpointNotice ? (
        <Card tone="soft" style={styles.noticeCard}>
          <Text style={[styles.noticeLabel, { color: colors.primary }]}>New automatic journey update</Text>
          <Text style={[styles.noticeText, { color: colors.foreground }]}>{checkpointNotice}</Text>
        </Card>
      ) : null}

      <Card style={styles.journeyCard}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your current trip</Text>
        {routeForSharing ? (
          <View style={styles.routePreview}>
            <Text style={[styles.eventTitle, { color: colors.foreground }]}>{routeForSharing.name}</Text>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>
              {routeForSharing.startStop} to {routeForSharing.destinationStop}
            </Text>
          </View>
        ) : (
          <Text style={[styles.muted, { color: colors.warning }]}>
            Choose a live provider route with geometry in Journey Planner before sharing. Demo routes cannot be shared.
          </Text>
        )}

        {profile.liveTrackingEnabled ? (
          <Button
            label="Opt in to live tracking"
            icon="map-pin"
            onPress={() => { void withBusy(startCurrentJourney); }}
            disabled={!routeForSharing || Boolean(activeJourney) || busy}
            loading={busy}
            testID="child-live-tracking-opt-in"
          />
        ) : (
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>
            Live tracking is off. Ask your parent to enable it in More.
          </Text>
        )}
        {activeJourney ? (
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>
            Finish or stop your current shared trip before starting another.
          </Text>
        ) : null}
      </Card>

      {profile.journeys.length ? (
        <View style={styles.journeyList}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your journeys</Text>
          {profile.journeys.slice().reverse().map((item) => (
            <ProfileJourneyCard
              key={item.id}
              journey={item}
              profile={profile}
              onChanged={refreshProfile}
              selectedJourneyId={journey?.id ?? null}
            />
          ))}
        </View>
      ) : (
        <Card>
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>
            No shared trips yet. Choose a live route above and opt in when you are ready.
          </Text>
        </Card>
      )}
      {profileQuery.isError ? (
        <Text accessibilityRole="alert" style={[styles.message, { color: colors.warning }]}>
          The latest journey update could not be loaded.
        </Text>
      ) : null}
      {message ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.warning }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 14, marginTop: 18 },
  privacyRow: { flexDirection: 'row', gap: 10 },
  privacyText: { flex: 1, fontSize: 13, lineHeight: 19 },
  content: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  accountTitle: { fontSize: 16, fontWeight: '700' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  journeyTitle: { fontSize: 16, fontWeight: '700' },
  eventTitle: { fontSize: 14, fontWeight: '600' },
  muted: { fontSize: 13, lineHeight: 18 },
  status: { fontSize: 13, fontWeight: '700' },
  selectedTag: { fontSize: 12, fontWeight: '700' },
  link: { fontSize: 13, fontWeight: '700' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  message: { fontSize: 13, lineHeight: 18 },
  codeBox: { borderRadius: 14, padding: 14, marginTop: 14, gap: 4 },
  invitationCode: { fontSize: 24, fontWeight: '800', letterSpacing: 3 },
  childList: { gap: 8, marginVertical: 8 },
  childChoice: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  childChoiceText: { fontSize: 14, fontWeight: '600' },
  routePreview: { paddingVertical: 8, gap: 4 },
  journeyList: { gap: 10 },
  journeyCard: { gap: 12 },
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressTrack: { height: 8, borderRadius: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 8 },
  checkinList: { gap: 8 },
  events: { gap: 10, paddingTop: 4 },
  eventRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  eventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  privacyNote: { fontSize: 13, lineHeight: 19 },
  noticeCard: { gap: 4 },
  noticeLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  noticeText: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
});