import {
  correctTrackingArrival,
  createTrackingFamily,
  createTrackingJourney,
  endTrackingJourney,
  getTrackingProfile,
  joinTrackingFamily,
  optInToTrackingJourney,
  recordTrackingCheckin,
  type TrackingJourney,
  type TrackingProfileResponse,
  type TrackingRoute,
} from '@workspace/api-client-react';
import { useAuth, useClerk } from '@clerk/expo';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, Card, ScreenHeader } from '@/components/OrivisUI';
import { TrackingAuthPanel } from '@/components/TrackingAuthPanel';
import { useColors } from '@/hooks/useColors';
import type { SelectedJourney } from '@/context/DemoContext';
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

function ProfileJourneyCard({
  journey,
  profile,
  getHeaders,
  onChanged,
  selectedJourneyId,
}: {
  journey: TrackingJourney;
  profile: TrackingProfileResponse;
  getHeaders: () => Promise<{ headers: { Authorization: string } }>;
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

      const auth = await getHeaders();
      const session = await optInToTrackingJourney(journey.id, auth);
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
      const auth = await getHeaders();
      await endTrackingJourney(journey.id, auth);
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
      const auth = await getHeaders();
      await recordTrackingCheckin(journey.id, { checkpointKey }, auth);
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
      const auth = await getHeaders();
      await correctTrackingArrival(journey.id, auth);
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
            Your parent approved this route. Agreeing starts sharing only for this trip. If location permission is unavailable, you can still check in manually.
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
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const [profile, setProfile] = useState<TrackingProfileResponse | null>(null);
  const [familyMissing, setFamilyMissing] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [childName, setChildName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [selectedChildId, setSelectedChildId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [checkpointNotice, setCheckpointNotice] = useState('');
  const seenEventId = useRef<string | null>(null);

  const getHeaders = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error('Your live-tracking account needs a fresh sign-in.');
    return { headers: { Authorization: `Bearer ${token}` } };
  }, [getToken]);

  const refreshProfile = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const nextProfile = await getTrackingProfile(await getHeaders());
      const latestEvent = latestAutomaticEvent(nextProfile);
      if (seenEventId.current && latestEvent && latestEvent.id !== seenEventId.current) {
        setCheckpointNotice(`${latestEvent.title}: ${latestEvent.subtitle}`);
      }
      seenEventId.current = latestEvent?.id ?? seenEventId.current;
      setProfile(nextProfile);
      setFamilyMissing(false);
      setMessage('');
    } catch (error) {
      if (errorStatus(error) === 404) {
        setProfile(null);
        setFamilyMissing(true);
        setMessage('');
      } else {
        setMessage(errorMessage(error));
      }
    } finally {
      setProfileLoaded(true);
    }
  }, [getHeaders, isSignedIn]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setProfile(null);
      setFamilyMissing(false);
      setProfileLoaded(true);
      return;
    }
    void refreshProfile();
    const timer = setInterval(() => { void refreshProfile(); }, 20_000);
    return () => clearInterval(timer);
  }, [isLoaded, isSignedIn, refreshProfile]);

  const routeForSharing = useMemo(() => toTrackingRoute(journey), [journey]);

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

  const createFamily = async () => {
    await createTrackingFamily({ familyName: familyName.trim() }, await getHeaders());
    setFamilyName('');
  };

  const joinFamily = async () => {
    await joinTrackingFamily(
      { invitationCode: invitationCode.trim(), displayName: childName.trim() },
      await getHeaders(),
    );
    setInvitationCode('');
    setChildName('');
  };

  const approveJourney = async () => {
    if (!routeForSharing || !selectedChild) {
      throw new Error('Choose a child and a live route with provider geometry.');
    }
    await createTrackingJourney(
      { childId: selectedChild.id, route: routeForSharing },
      await getHeaders(),
    );
  };

  const activeJourney = profile?.journeys.find(
    (item) => item.status === 'active' || item.status === 'awaiting_child',
  );
  const selectedChild = profile?.children.find(({ id }) => id === selectedChildId) ?? profile?.children[0];
  const signOutTrackingAccount = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (profile?.role === 'child') {
        const sharingJourney = profile.journeys.find((item) => item.status === 'active');
        if (sharingJourney) {
          await endTrackingJourney(sharingJourney.id, await getHeaders());
        }
        if (Platform.OS !== 'web') {
          if (await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK)) {
            await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
          }
          await SecureStore.deleteItemAsync(ACTIVE_TRACKING_SESSION_KEY);
        }
      }
      await signOut();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!isLoaded || (isSignedIn && !profileLoaded)) {
    return (
      <Card>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Private journey sharing</Text>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading your separate tracking account…</Text>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow="Family safety"
        title="Live journey sharing"
        subtitle="Optional, temporary route progress. Exact location is never shown to the parent."
      />
      <Card tone="soft">
        <View style={styles.privacyRow}>
          <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
            Parent and child accounts are separate from shared demo sign-in. The server stores only an encrypted current fix while sharing; stopping or expiry clears it, while checkpoint history remains.
          </Text>
        </View>
      </Card>

      {!isSignedIn ? <TrackingAuthPanel /> : null}

      {isSignedIn && familyMissing ? (
        <Card>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Connect a tracking family</Text>
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>
            A parent creates the family. The child signs in with a separate account and joins with the invitation code.
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 6 }]}>Parent setup</Text>
          <TextInput
            value={familyName}
            onChangeText={setFamilyName}
            placeholder="Family name"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          />
          <Button
            label="Create tracking family"
            icon="users"
            onPress={() => { void withBusy(createFamily); }}
            disabled={!familyName.trim()}
            loading={busy}
          />
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 10 }]}>Child setup</Text>
          <TextInput
            value={childName}
            onChangeText={setChildName}
            placeholder="Child's display name"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          />
          <TextInput
            value={invitationCode}
            onChangeText={(value) => setInvitationCode(value.replace(/\D/g, '').slice(0, 10))}
            keyboardType="number-pad"
            placeholder="10-digit family code"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          />
          <Button
            label="Join family as child"
            icon="user-plus"
            variant="secondary"
            onPress={() => { void withBusy(joinFamily); }}
            disabled={!childName.trim() || invitationCode.length !== 10}
            loading={busy}
          />
          {message ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.warning }]}>{message}</Text> : null}
        </Card>
      ) : null}

      {profile ? (
        <>
          <Card>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[styles.accountTitle, { color: colors.foreground }]}>
                  {profile.familyName} · {profile.role === 'parent' ? 'Parent account' : 'Child account'}
                </Text>
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                  Separate live-tracking identity
                </Text>
              </View>
              <Pressable onPress={() => { void signOutTrackingAccount(); }} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.link, { color: colors.primary }]}>Sign out</Text>
              </Pressable>
            </View>
            {profile.role === 'parent' && profile.invitationCode ? (
              <View style={[styles.codeBox, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>Child invitation code</Text>
                <Text selectable style={[styles.invitationCode, { color: colors.foreground }]}>{profile.invitationCode}</Text>
              </View>
            ) : null}
          </Card>

          {checkpointNotice ? (
            <Card tone="soft" style={styles.noticeCard}>
              <Text style={[styles.noticeLabel, { color: colors.primary }]}>New automatic journey update</Text>
              <Text style={[styles.noticeText, { color: colors.foreground }]}>{checkpointNotice}</Text>
            </Card>
          ) : null}

          {profile.role === 'parent' ? (
            <Card>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Approve a journey</Text>
              {profile.children.length ? (
                <View style={styles.childList}>
                  {profile.children.map((child) => (
                    <Pressable
                      key={child.id}
                      onPress={() => setSelectedChildId(child.id)}
                      style={[
                        styles.childChoice,
                        {
                          backgroundColor: (selectedChild?.id ?? '') === child.id ? colors.accent : colors.background,
                          borderColor: (selectedChild?.id ?? '') === child.id ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.childChoiceText, { color: colors.foreground }]}>{child.name}</Text>
                      {(selectedChild?.id ?? '') === child.id ? <Text style={{ color: colors.primary }}>Selected</Text> : null}
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>A child must join with their own account before you can approve a trip.</Text>
              )}
              {routeForSharing ? (
                <View style={styles.routePreview}>
                  <Text style={[styles.eventTitle, { color: colors.foreground }]}>{routeForSharing.name}</Text>
                  <Text style={[styles.muted, { color: colors.mutedForeground }]}>{routeForSharing.startStop} to {routeForSharing.destinationStop}</Text>
                </View>
              ) : (
                <Text style={[styles.muted, { color: colors.warning }]}>
                  Select a live route with provider geometry and endpoint coordinates in Journey Planner. Demo routes cannot be shared.
                </Text>
              )}
              <Button
                label="Approve and send to child"
                icon="send"
                onPress={() => { void withBusy(approveJourney); }}
                disabled={!selectedChild || !routeForSharing || Boolean(activeJourney)}
                loading={busy}
              />
              {activeJourney ? (
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                  Finish or cancel the current trip before approving another one.
                </Text>
              ) : null}
            </Card>
          ) : null}

          {profile.journeys.length ? (
            <View style={styles.journeyList}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {profile.role === 'parent' ? 'Family journeys' : 'Your journeys'}
              </Text>
              {profile.journeys.slice().reverse().map((item) => (
                <ProfileJourneyCard
                  key={item.id}
                  journey={item}
                  profile={profile}
                  getHeaders={getHeaders}
                  onChanged={refreshProfile}
                  selectedJourneyId={journey?.id ?? null}
                />
              ))}
            </View>
          ) : (
            <Card>
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                {profile.role === 'parent'
                  ? 'No family journeys yet. Choose a live provider route above to send an approval request.'
                  : 'No trip requests yet. Your parent can approve a provider-routed trip.'}
              </Text>
            </Card>
          )}
          {message ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.warning }]}>{message}</Text> : null}
        </>
      ) : null}
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