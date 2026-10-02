import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import {
  getGetAccountStatusQueryKey,
  getGetFamilyJourneyQueryKey,
  getGetJourneyMapQueryKey,
  getGetReportMapDataQueryKey,
  useConfirmFamilyJourneyMilestone,
  useGetAccountStatus,
  useGetFamilyJourney,
  useGetJourneyMap,
  useGetReportMapData,
  useSaveFamilyJourney,
  type FamilyJourney,
  type JourneyRoute,
  type TravelModeParameter,
} from '@workspace/api-client-react';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, ScreenHeader, SectionTitle } from '@/components/OrivisUI';
import { GoogleJourneyMap } from '@/components/GoogleJourneyMap';
import { JourneyMap } from '@/components/JourneyMap';
import { LocationAutocompleteField, type SelectedPlace } from '@/components/LocationAutocompleteField';
import { buildJourneyMilestones, type SelectedJourney, useDemo } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';

const MODE_OPTIONS: { value: TravelModeParameter; label: string }[] = [
  { value: 'any', label: 'Best option' },
  { value: 'transit', label: 'Bus only' },
  { value: 'walking', label: 'Walking only' },
];

function toSelectedJourney(shared: FamilyJourney): SelectedJourney {
  const route = shared.route;
  return {
    id: route.id,
    name: route.name,
    startStop: route.startStop,
    destinationStop: route.destinationStop,
    destination: shared.destination.name,
    startingLocation: shared.origin.name,
    originLatitude: shared.origin.latitude,
    originLongitude: shared.origin.longitude,
    destinationLatitude: shared.destination.latitude,
    destinationLongitude: shared.destination.longitude,
    durationMinutes: route.durationMinutes,
    walkingMeters: route.walkingMeters,
    transfers: route.transfers,
    delayMinutes: route.delayMinutes,
    alerts: route.alerts,
    source: route.source,
    mode: route.mode,
    legs: route.legs.map((leg) => ({
      type: leg.type,
      routeNumber: leg.routeNumber,
      routeName: leg.routeName,
      boardingStop: { name: leg.boardingStop.name },
      alightingStop: { name: leg.alightingStop.name },
      durationMinutes: leg.durationMinutes,
      delayMinutes: leg.delayMinutes,
      transferGuidance: leg.transferGuidance,
    })),
  };
}

export function JourneyScreen() {
  const colors = useColors();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const { state, syncSharedJourney } = useDemo();
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const accountQuery = useGetAccountStatus({
    query: { queryKey: getGetAccountStatusQueryKey(), enabled: !!userId, retry: false },
  });
  const account = accountQuery.data;
  const familyAllowed = account?.status === 'parent' || account?.status === 'child_approved';
  const canCheckIn = account?.status === 'child_approved';
  const userScope = [userId ?? '', account?.status ?? '', account?.familyId ?? '', account?.teamName ?? ''];
  const familyJourneyQueryKey = [...getGetFamilyJourneyQueryKey(), ...userScope];
  const reportMapQueryKey = [...getGetReportMapDataQueryKey(), ...userScope];
  const familyJourneyQuery = useGetFamilyJourney({
    query: {
      queryKey: familyJourneyQueryKey,
      enabled: !!userId && familyAllowed,
      staleTime: 5_000,
      refetchInterval: 15_000,
    },
  });
  const reportMapQuery = useGetReportMapData({
    query: { queryKey: reportMapQueryKey, enabled: !!userId && familyAllowed, staleTime: 12_000 },
  });
  const saveFamilyJourney = useSaveFamilyJourney({
    mutation: {
      onSuccess: (data) => queryClient.setQueryData(familyJourneyQueryKey, data),
    },
  });
  const confirmFamilyJourneyMilestone = useConfirmFamilyJourneyMilestone({
    mutation: {
      onSuccess: (data) => queryClient.setQueryData(familyJourneyQueryKey, data),
    },
  });
  const syncedJourneyKey = useRef('');
  const [saveError, setSaveError] = useState('');
  const [checkInError, setCheckInError] = useState('');
  const savedJourney = state.selectedJourney;
  const [origin, setOrigin] = useState<SelectedPlace | null>(() => {
    return savedJourney?.originLatitude != null && savedJourney.originLongitude != null
      ? {
        placeId: 'saved-origin',
        name: savedJourney.startingLocation ?? '',
        lat: savedJourney.originLatitude,
        lng: savedJourney.originLongitude,
      }
      : null;
  });
  const [originText, setOriginText] = useState(() =>
    savedJourney?.originLatitude != null && savedJourney.originLongitude != null
      ? savedJourney.startingLocation ?? ''
      : '');
  const [usingDeviceLocation, setUsingDeviceLocation] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [destination, setDestination] = useState(() =>
    savedJourney?.destinationLatitude != null && savedJourney.destinationLongitude != null
      ? savedJourney.destination
      : '');
  const [destinationCoordinates, setDestinationCoordinates] = useState<SelectedPlace | null>(() => {
    return savedJourney?.destinationLatitude != null && savedJourney.destinationLongitude != null
      ? {
        placeId: 'saved-destination',
        name: savedJourney.destination,
        lat: savedJourney.destinationLatitude,
        lng: savedJourney.destinationLongitude,
      }
      : null;
  });
  const [searchRequested, setSearchRequested] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<TravelModeParameter>('any');
  const [mapView, setMapView] = useState<'2d' | '3d'>('2d');
  const [showHeat, setShowHeat] = useState(false);
  const [googleMapFailed, setGoogleMapFailed] = useState(false);
  const [mapNotice, setMapNotice] = useState('');
  const [mapLinkError, setMapLinkError] = useState('');
  const serverJourney = familyJourneyQuery.data?.journey ?? null;
  const familyId = account?.familyId ?? '';
  const serverJourneySyncKey = `${JSON.stringify(userScope)}:${serverJourney?.id ?? 'empty'}:${serverJourney?.updatedAt ?? ''}:${serverJourney?.milestoneIndex ?? -1}`;

  useEffect(() => {
    if (!familyId || !familyJourneyQuery.isSuccess || syncedJourneyKey.current === serverJourneySyncKey) return;
    syncedJourneyKey.current = serverJourneySyncKey;
    if (!serverJourney) {
      syncSharedJourney(null, -1, null);
      setOrigin(null);
      setOriginText('');
      setUsingDeviceLocation(false);
      setDestination('');
      setDestinationCoordinates(null);
      setSearchRequested(false);
      setSelectedRouteId(null);
      return;
    }
    syncSharedJourney(toSelectedJourney(serverJourney), serverJourney.milestoneIndex, serverJourney.tripUpdatedAt);
    setOrigin({
      placeId: 'saved-origin',
      name: serverJourney.origin.name,
      lat: serverJourney.origin.latitude,
      lng: serverJourney.origin.longitude,
    });
    setOriginText(serverJourney.origin.name);
    setUsingDeviceLocation(serverJourney.origin.name === 'Your current location');
    setDestination(serverJourney.destination.name);
    setDestinationCoordinates({
      placeId: 'saved-destination',
      name: serverJourney.destination.name,
      lat: serverJourney.destination.latitude,
      lng: serverJourney.destination.longitude,
    });
    setSelectedRouteId(serverJourney.route.id);
    setTravelMode(serverJourney.route.mode);
    setSearchRequested(true);
    setMapView('2d');
    setGoogleMapFailed(false);
  }, [
    familyId,
    familyJourneyQuery.isSuccess,
    serverJourney,
    serverJourneySyncKey,
    syncSharedJourney,
  ]);

  const searchedDestination = destinationCoordinates?.name ?? '';
  const endpointsSelected = !!origin && !!destinationCoordinates;
  const journeyParams = {
    lat: origin?.lat ?? 0,
    lng: origin?.lng ?? 0,
    destination: searchedDestination,
    destinationLat: destinationCoordinates?.lat ?? 0,
    destinationLng: destinationCoordinates?.lng ?? 0,
    mode: travelMode,
  };
  const journey = useGetJourneyMap(
    journeyParams,
    { query: { queryKey: getGetJourneyMapQueryKey(journeyParams), enabled: searchRequested && endpointsSelected, staleTime: 60_000, retry: 2 } },
  );
  const routes = searchRequested ? journey.data?.routes ?? [] : [];
  const selectedRoute = routes.find((route) => route.id === selectedRouteId)
    ?? (serverJourney?.route.id === selectedRouteId ? serverJourney.route : null)
    ?? routes.find((route) => route.recommended)
    ?? routes[0];
  const savedJourneyMatchesRoute = Boolean(
    selectedRoute &&
    savedJourney?.id === selectedRoute.id &&
    savedJourney.destination === searchedDestination &&
    savedJourney.startStop === selectedRoute.startStop &&
    savedJourney.source === selectedRoute.source &&
    savedJourney.mode === selectedRoute.mode,
  );
  const savedJourneyMatchesEndpoints = Boolean(
    savedJourney &&
    origin &&
    destinationCoordinates &&
    savedJourney.originLatitude === origin.lat &&
    savedJourney.originLongitude === origin.lng &&
    savedJourney.destinationLatitude === destinationCoordinates.lat &&
    savedJourney.destinationLongitude === destinationCoordinates.lng,
  );
  const canOpenSavedJourney = Boolean(
    savedJourney &&
    isValidCoordinate(savedJourney.originLatitude, savedJourney.originLongitude) &&
    isValidCoordinate(savedJourney.destinationLatitude, savedJourney.destinationLongitude),
  );
  const hasMissingGeometry = Boolean(selectedRoute?.legs.some((leg) => !leg.polyline));
  const canUseGoogleMap = searchRequested && !!journey.data?.map3dAvailable && !googleMapFailed;
  const geocodedReports = reportMapQuery.data?.markers ?? [];
  const reportPoints = geocodedReports.slice(0, 80).map((report) => ({
    lat: report.latitude, lng: report.longitude,
  }));
  const heatPoints = showHeat ? (reportMapQuery.data?.publicHeat ?? []).map((cell) => ({
    lat: cell.latitude, lng: cell.longitude, intensity: cell.intensity,
  })) : [];
  const milestones = savedJourney ? buildJourneyMilestones(savedJourney) : [];
  const progressIndex = serverJourney?.milestoneIndex ?? -1;
  const nextMilestoneIndex = progressIndex + 1;
  const nextMilestone = milestones[nextMilestoneIndex];

  const openSavedJourneyInMaps = async (provider: 'google' | 'apple') => {
    if (!savedJourney || !canOpenSavedJourney) {
      setMapLinkError('Route coordinates are unavailable. Find and select the route again.');
      return;
    }
    const originPoint = `${savedJourney.originLatitude},${savedJourney.originLongitude}`;
    const destinationPoint = `${savedJourney.destinationLatitude},${savedJourney.destinationLongitude}`;
    const walking = savedJourney.mode === 'walking';
    const params = new URLSearchParams();
    if (provider === 'google') {
      params.set('api', '1');
      params.set('origin', originPoint);
      params.set('destination', destinationPoint);
      params.set('travelmode', walking ? 'walking' : 'transit');
    } else {
      params.set('saddr', originPoint);
      params.set('daddr', destinationPoint);
      params.set('dirflg', walking ? 'w' : 'r');
    }
    const url = provider === 'google'
      ? `https://www.google.com/maps/dir/?${params.toString()}`
      : `https://maps.apple.com/?${params.toString()}`;
    try {
      await Linking.openURL(url);
      setMapLinkError('');
    } catch {
      setMapLinkError(`Could not open ${provider === 'google' ? 'Google Maps' : 'Apple Maps'}. Try opening the link in a browser.`);
    }
  };

  const locate = async () => {
    setLocationError('');
    try {
      const access = permission?.granted ? permission : await requestPermission();
      if (!access.granted) {
        setLocationError('Location access was not granted. Select a starting place or try again.');
        return;
      }
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const place = {
        placeId: 'device-location',
        name: 'Your current location',
        lat: result.coords.latitude,
        lng: result.coords.longitude,
      };
      setOrigin(place);
      setOriginText(place.name);
      setUsingDeviceLocation(true);
      setSearchRequested(false);
      setGoogleMapFailed(false);
      setSelectedRouteId(null);
      setMapView('2d');
      setMapNotice('');
      setMapLinkError('');
    } catch {
      setLocationError('Location is unavailable. Select a starting place instead.');
    }
  };

  const chooseRoute = async (route: JourneyRoute) => {
    if (!origin || !destinationCoordinates) {
      setSaveError('Select both trip endpoints before saving this route.');
      return;
    }
    setSaveError('');
    try {
      const response = await saveFamilyJourney.mutateAsync({
        data: {
          route,
          origin: {
            name: origin.name,
            latitude: origin.lat,
            longitude: origin.lng,
          },
          destination: {
            name: destinationCoordinates.name,
            latitude: destinationCoordinates.lat,
            longitude: destinationCoordinates.lng,
          },
        },
      });
      if (!response.journey) throw new Error('The saved journey was not returned by the server.');
      queryClient.setQueryData(familyJourneyQueryKey, response);
      syncSharedJourney(
        toSelectedJourney(response.journey),
        response.journey.milestoneIndex,
        response.journey.tripUpdatedAt,
      );
      setSelectedRouteId(route.id);
      setMapLinkError('');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The shared family route could not be saved.');
    }
  };

  const confirmNextMilestone = async () => {
    if (!serverJourney || !nextMilestone) return;
    setCheckInError('');
    try {
      const response = await confirmFamilyJourneyMilestone.mutateAsync({
        data: { milestoneIndex: nextMilestoneIndex },
      });
      if (!response.journey) throw new Error('The updated journey was not returned by the server.');
      queryClient.setQueryData(familyJourneyQueryKey, response);
      syncSharedJourney(
        toSelectedJourney(response.journey),
        response.journey.milestoneIndex,
        response.journey.tripUpdatedAt,
      );
    } catch (error) {
      setCheckInError(error instanceof Error ? error.message : 'The trip check-in could not be saved.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <ScreenHeader eyebrow="Journey planner" title="Find a better way there" subtitle="Live transit options when available. Your location is used only while planning, never tracked in the background." />
      <Card tone="soft">
        <View style={styles.infoRow}>
          <Feather name="map-pin" size={20} color={colors.primary} />
          <Text style={[styles.small, styles.flex, { color: colors.mutedForeground }]}>
            Choose a place for each endpoint, or use your device location for the start. Location access is requested only when you tap the current-location button.
          </Text>
        </View>
        <LocationAutocompleteField
          label="Starting Location"
          value={originText}
          onChangeText={(text) => {
            setOriginText(text);
            setOrigin(null);
            setUsingDeviceLocation(false);
            setSearchRequested(false);
            setGoogleMapFailed(false);
            setSelectedRouteId(null);
            setMapView('2d');
            setMapLinkError('');
          }}
          onSelect={(place) => {
            setOrigin(place);
            setOriginText(place.name);
            setUsingDeviceLocation(false);
            setSearchRequested(false);
            setGoogleMapFailed(false);
            setLocationError('');
            setSelectedRouteId(null);
            setMapView('2d');
            setMapLinkError('');
          }}
          placeholder="Search an address, business, school, or landmark"
          testID="journey-origin"
          initiallySelected={!!origin}
        />
        {origin ? (
          <Text style={[styles.small, { color: colors.mutedForeground }]}>
            {usingDeviceLocation ? 'Using your current position' : `Selected start · ${origin.name}`}
          </Text>
        ) : (
          <Text style={[styles.small, { color: colors.warning }]}>Choose a suggested starting place before finding routes.</Text>
        )}
        <Button label="Use My Current Location" icon="navigation" onPress={() => { void locate(); }} testID="use-my-location" />
        {locationError ? <Text style={[styles.small, { color: colors.destructive }]}>{locationError}</Text> : null}
        {permission?.status === 'denied' && !permission.canAskAgain && Platform.OS !== 'web' ? (
          <Button label="Open location settings" icon="settings" variant="secondary" onPress={() => { void Linking.openSettings().catch(() => setLocationError('Unable to open settings.')); }} />
        ) : null}
        <LocationAutocompleteField
          label="Destination"
          value={destination}
          onChangeText={(text) => {
            setDestination(text);
            setDestinationCoordinates(null);
            setSearchRequested(false);
            setGoogleMapFailed(false);
            setSelectedRouteId(null);
            setMapView('2d');
            setMapLinkError('');
          }}
          onSelect={(place) => {
            setDestination(place.name);
            setDestinationCoordinates(place);
            setSearchRequested(false);
            setGoogleMapFailed(false);
            setSelectedRouteId(null);
            setMapView('2d');
            setMapLinkError('');
          }}
          placeholder="Search an address, business, school, or landmark"
          testID="journey-destination"
          initiallySelected={!!destinationCoordinates}
        />
        {destinationCoordinates ? (
          <Text style={[styles.small, { color: colors.mutedForeground }]}>
            Selected destination coordinates · {destinationCoordinates.lat.toFixed(5)}, {destinationCoordinates.lng.toFixed(5)}
          </Text>
        ) : null}
      </Card>
      <Button
        label="Find routes"
        icon="search"
        disabled={!endpointsSelected}
        onPress={() => {
          if (endpointsSelected) {
            setSearchRequested(true);
            setGoogleMapFailed(false);
            setSelectedRouteId(null);
            setMapView('2d');
            setMapNotice('');
            setMapLinkError('');
          }
        }}
        testID="find-routes"
      />
      <View style={styles.matches}>
        {MODE_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={travelMode === option.value}
            onPress={() => { setTravelMode(option.value); setSelectedRouteId(null); setGoogleMapFailed(false); }}
          />
        ))}
      </View>

      <SectionTitle title="Journey map" />
      <Chip label={showHeat ? 'Hide safety heat map' : 'Show safety heat map'} active={showHeat} onPress={() => setShowHeat(!showHeat)} />
      {searchRequested ? (
        <View style={[styles.mapModeBar, { backgroundColor: colors.muted }]}>
          {(['2d', '3d'] as const).map((view) => {
            const unavailable = view === '3d' && !journey.data?.map3dAvailable;
            const active = mapView === view;
            return (
              <Pressable
                key={view}
                accessibilityRole="button"
                accessibilityLabel={`Show ${view.toUpperCase()} map`}
                accessibilityState={{ selected: active, disabled: unavailable }}
                testID={`journey-map-view-${view}`}
                disabled={unavailable}
                onPress={() => {
                  setMapView(view);
                  setMapNotice('');
                  if (view === '3d') setGoogleMapFailed(false);
                }}
                style={[
                  styles.mapModeButton,
                  {
                    backgroundColor: active ? colors.card : 'transparent',
                    opacity: unavailable ? 0.45 : 1,
                  },
                ]}
              >
                <Text style={[styles.mapModeText, { color: active ? colors.primary : colors.mutedForeground }]}>
                  {view.toUpperCase()}
                </Text>
                <Text style={[styles.mapModeSubtext, { color: active ? colors.foreground : colors.mutedForeground }]}>
                  {view === '2d' ? 'Street map' : unavailable ? 'Unavailable' : 'Globe view'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {searchRequested && !journey.data?.map3dAvailable ? (
        <Text style={[styles.caption, { color: colors.mutedForeground }]}>
          3D maps are unavailable right now. The 2D route map is still available.
        </Text>
      ) : null}
      {mapNotice ? <Text style={[styles.small, { color: colors.warning }]}>{mapNotice}</Text> : null}
      {searchRequested && journey.isFetching && !journey.data ? (
        <View style={[styles.mapPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.small, { color: colors.mutedForeground }]}>Loading route and map…</Text>
        </View>
      ) : mapView === '3d' && canUseGoogleMap ? (
        <GoogleJourneyMap
          lat={origin?.lat ?? 0}
          lng={origin?.lng ?? 0}
          destination={searchedDestination}
          destinationLat={destinationCoordinates?.lat ?? 0}
          destinationLng={destinationCoordinates?.lng ?? 0}
          mode={travelMode}
          routeId={selectedRoute?.id ?? 'base-map'}
          heatPoints={heatPoints}
          reportPoints={reportPoints}
          onError={() => {
            setGoogleMapFailed(true);
            setMapView('2d');
            setMapNotice('The 3D map could not load. Showing the 2D route map instead.');
          }}
        />
      ) : mapView === '3d' ? (
        <View
          testID="journey-3d-map-unavailable"
          style={[styles.mapPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="alert-triangle" size={22} color={colors.warning} />
          <Text style={[styles.small, { color: colors.mutedForeground, textAlign: 'center' }]}>
            {googleMapFailed
              ? 'The 3D map could not load. Switch to 2D or try the 3D map again.'
              : 'The 3D map is unavailable for this search. The 2D route map remains available.'}
          </Text>
        </View>
      ) : selectedRoute ? (
        <JourneyMap
          legs={selectedRoute.legs}
          heatPoints={heatPoints}
          fallbackLat={origin?.lat ?? 0}
          fallbackLng={origin?.lng ?? 0}
        />
      ) : (
        <View
          testID={searchRequested ? 'journey-map-unavailable' : 'journey-map-empty'}
          style={[styles.mapPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name={searchRequested ? 'alert-triangle' : 'map-pin'} size={22} color={searchRequested ? colors.warning : colors.primary} />
          <Text style={[styles.small, { color: colors.mutedForeground, textAlign: 'center' }]}>
            {!searchRequested
              ? 'Select both places and tap Find routes to display the 2D map.'
              : journey.isError
                ? 'Journey data is unavailable. Refresh to try again.'
                : 'No route geometry is available to display for this search.'}
          </Text>
        </View>
      )}
      {searchRequested && mapView === '2d' && selectedRoute ? (
        <Text style={[styles.caption, { color: colors.mutedForeground }]}>
          2D street map · OpenStreetMap. Exact route shapes are used when available.
        </Text>
      ) : null}
      {searchRequested && mapView === '3d' && canUseGoogleMap ? (
        <Text style={[styles.caption, { color: colors.mutedForeground }]}>
          Google Maps 3D · selected route, stops, destination, reports, and safety heat map.
        </Text>
      ) : null}
      {searchRequested && mapView === '2d' && hasMissingGeometry ? (
        <Text style={[styles.caption, { color: colors.warning }]}>
          {selectedRoute?.source === 'demo'
            ? 'This is an illustrative route with no verified path shape. Follow the example steps below.'
            : 'Some exact route shapes are unavailable. Stops remain visible, and no straight-line substitute is drawn; follow the listed steps.'}
        </Text>
      ) : null}
      {showHeat && !geocodedReports.length && !(reportMapQuery.data?.publicHeat.length) ? <Text style={[styles.caption, { color: colors.mutedForeground }]}>No authorized report locations or anonymous heat cells are available to display.</Text> : null}
      {reportMapQuery.isError ? <Text style={[styles.caption, { color: colors.warning }]}>Safety map data is unavailable right now.</Text> : null}
      {familyJourneyQuery.isError ? <Text style={[styles.caption, { color: colors.warning }]}>Your family's saved trip could not be loaded. You can still search routes and retry saving.</Text> : null}
      {searchRequested && journey.isError ? <Text style={[styles.small, { color: colors.destructive }]}>Live route data is unavailable. Tap Refresh to retry.</Text> : null}
      {searchRequested && journey.data?.message ? <Text style={[styles.small, { color: colors.mutedForeground }]}>{journey.data.message}</Text> : null}
      {searchRequested && travelMode !== 'walking' ? (
        <Card>
          <Text style={[styles.title, { color: colors.foreground }]}>Nearest available VTA stop</Text>
          <Text style={[styles.small, { color: colors.mutedForeground }]}>
            {journey.data?.nearestStop?.name ?? (journey.isError ? 'VTA stop data is unavailable.' : 'No nearby VTA stops were returned.')}
            {journey.data?.nearestStop?.distanceMeters != null ? ` · ${Math.round(journey.data.nearestStop.distanceMeters)} m away` : ''}
          </Text>
          <Text style={[styles.small, { color: colors.mutedForeground }]}>
            Destination stop options: {[...new Set(routes.map((route) => route.destinationStop))].join(' · ') || 'No live routes found'}
          </Text>
        </Card>
      ) : null}

      <SectionTitle
        title="Route options"
        action={searchRequested ? 'Refresh' : undefined}
        onAction={searchRequested ? () => { setGoogleMapFailed(false); void journey.refetch(); } : undefined}
      />
      {searchRequested && journey.isFetching && !journey.data ? <ActivityIndicator color={colors.primary} /> : null}
      {searchRequested && !journey.isFetching && !journey.isError && !routes.length ? (
        <Text style={[styles.small, { color: colors.mutedForeground }]}>No route options were returned for these selected places.</Text>
      ) : null}
      {routes.map((route) => (
        <Pressable key={route.id} testID={`route-${route.id}`} onPress={() => { setSelectedRouteId(route.id); setMapLinkError(''); }} style={[styles.option, { backgroundColor: colors.card, borderColor: selectedRoute?.id === route.id ? colors.primary : colors.border }]}>
          <View style={styles.optionHeading}>
            <View style={styles.flex}>
              {route.recommended ? <Text style={[styles.recommended, { color: colors.primary }]}>RECOMMENDED ROUTE</Text> : null}
              <Text style={[styles.title, { color: colors.foreground }]}>{route.name}</Text>
            </View>
            <Feather name={selectedRoute?.id === route.id ? 'check-circle' : 'circle'} size={20} color={colors.primary} />
          </View>
          <Text style={[styles.small, { color: colors.mutedForeground }]}>{route.startStop} → {route.destinationStop}</Text>
          <Text style={[styles.metrics, { color: colors.foreground }]}>{route.durationMinutes} min · {route.walkingMeters} m walk · {route.transfers} transfer{route.transfers === 1 ? '' : 's'}</Text>
           <Text style={[styles.small, { color: route.delayMinutes ? colors.warning : colors.mutedForeground }]}>{route.delayMinutes ? `${route.delayMinutes} min delay` : route.mode === 'transit' && route.source === 'live' && route.legs.filter((leg) => leg.type === 'bus').every((leg) => leg.delayMinutes === null) ? 'Live delay unknown' : 'No reported delay'} · {route.available ? 'Available' : 'Cannot catch this connection'} · {route.source === 'live' ? route.mode === 'walking' ? 'Google walking estimate' : route.name.startsWith('Google Transit ·') ? 'Google transit directions' : '511 VTA scheduled bus' : 'Demo fallback'}</Text>
          {route.legs.map((leg, index) => (
            <Text key={`${route.id}-leg-${index}`} style={[styles.small, { color: colors.mutedForeground }]}>
              {leg.type === 'walk'
                ? `Walk ${leg.durationMinutes} min to ${leg.alightingStop.name}`
                : `Ride ${leg.routeNumber ?? leg.routeName ?? 'bus'} from ${leg.boardingStop.name} to ${leg.alightingStop.name} · ${leg.durationMinutes} min`}
               {leg.transferGuidance ? ` · ${leg.transferGuidance}` : ''}
               {leg.predictedArrival ? ` · ${leg.delayMinutes === null ? 'Scheduled' : 'Estimated'} arrival ${new Date(leg.predictedArrival).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
               {leg.delayMinutes ? ` · ${leg.delayMinutes} min delay` : ''}
            </Text>
          ))}
          {route.alerts.map((alert, index) => <Text key={`${index}-${alert}`} style={[styles.small, { color: colors.warning }]}>Service alert: {alert}</Text>)}
        </Pressable>
      ))}
      {selectedRoute ? (
        <Button
          label={savedJourneyMatchesRoute ? 'Shared with your family' : 'Save route for your family'}
          icon={savedJourneyMatchesRoute ? 'check-circle' : 'check'}
          onPress={() => { void chooseRoute(selectedRoute); setMapLinkError(''); }}
          disabled={!selectedRoute.available || saveFamilyJourney.isPending || savedJourneyMatchesRoute}
          testID="choose-route"
        />
      ) : null}
      {saveFamilyJourney.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      {saveError ? <Text accessibilityRole="alert" style={[styles.small, { color: colors.destructive }]}>{saveError}</Text> : null}
      {serverJourney && savedJourney ? (
        <Card style={styles.savedRouteCard}>
          <Text style={[styles.title, { color: colors.foreground }]}>Shared family trip</Text>
          <Text style={[styles.small, { color: colors.mutedForeground }]}>
            {serverJourney.origin.name} → {serverJourney.destination.name} · {serverJourney.route.name}
          </Text>
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>
            {progressIndex >= 0 ? `${progressIndex + 1} of ${milestones.length} steps confirmed` : 'No check-ins yet'}
            {serverJourney.tripUpdatedAt ? ` · Updated ${new Date(serverJourney.tripUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
          </Text>
          {milestones.map((milestone, index) => {
            const completed = index <= progressIndex;
            return (
              <View key={milestone.key} style={styles.milestoneRow}>
                <Feather name={completed ? 'check-circle' : 'circle'} size={18} color={completed ? colors.primary : colors.mutedForeground} />
                <View style={styles.flex}>
                  <Text style={[styles.small, { color: colors.foreground }]}>{milestone.title}</Text>
                  <Text style={[styles.caption, { color: colors.mutedForeground }]}>{milestone.subtitle}</Text>
                </View>
              </View>
            );
          })}
          {canCheckIn && nextMilestone ? (
            <Button
              label={`Confirm next step: ${nextMilestone.title}`}
              icon="check"
              onPress={() => { void confirmNextMilestone(); }}
              disabled={confirmFamilyJourneyMilestone.isPending}
              testID="confirm-family-journey-check-in"
            />
          ) : null}
          {canCheckIn && !nextMilestone ? <Text style={[styles.small, { color: colors.primary }]}>All trip steps are confirmed.</Text> : null}
          {confirmFamilyJourneyMilestone.isPending ? <ActivityIndicator color={colors.primary} /> : null}
          {checkInError ? <Text accessibilityRole="alert" style={[styles.small, { color: colors.destructive }]}>{checkInError}</Text> : null}
        </Card>
      ) : null}
      {savedJourneyMatchesRoute && canOpenSavedJourney ? (
        <>
          <Button label="Open in Google Maps" icon="map" variant="secondary" onPress={() => { void openSavedJourneyInMaps('google'); }} testID="open-route-google-maps" />
          <Button label="Open in Apple Maps" icon="map" variant="secondary" onPress={() => { void openSavedJourneyInMaps('apple'); }} testID="open-route-apple-maps" />
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>
            External map apps may calculate a different path. Confirm the route and service details before traveling.
          </Text>
        </>
      ) : null}
      {!searchRequested && savedJourneyMatchesEndpoints && canOpenSavedJourney ? (
        <Card style={styles.savedRouteCard}>
          <Text style={[styles.title, { color: colors.foreground }]}>Your selected route</Text>
          <Text style={[styles.small, { color: colors.mutedForeground }]}>
            {savedJourney?.startingLocation || savedJourney?.startStop} → {savedJourney?.destination}
          </Text>
          <Button label="Open in Google Maps" icon="map" variant="secondary" onPress={() => { void openSavedJourneyInMaps('google'); }} testID="open-saved-route-google-maps" />
          <Button label="Open in Apple Maps" icon="map" variant="secondary" onPress={() => { void openSavedJourneyInMaps('apple'); }} testID="open-saved-route-apple-maps" />
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>
            External map apps may calculate a different path. Confirm the route and service details before traveling.
          </Text>
        </Card>
      ) : null}
      {mapLinkError ? <Text accessibilityRole="alert" style={[styles.small, { color: colors.destructive }]}>{mapLinkError}</Text> : null}
      {searchRequested && journey.data?.alerts.length ? (
        <>
          <SectionTitle title="Service alerts" />
          {journey.data.alerts.map((alert, index) => <Text key={`${index}-${alert}`} style={[styles.small, { color: colors.warning }]}>{alert}</Text>)}
        </>
      ) : null}
      <Text style={[styles.caption, { color: colors.mutedForeground }]}>Timings and alerts may change. Check the operator before traveling. No regular-use child location tracking.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 120, gap: 12 },
  flex: { flex: 1 },
  infoRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  mapPlaceholder: { height: 255, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  mapModeBar: { flexDirection: 'row', gap: 5, padding: 4, borderRadius: 15 },
  mapModeButton: { flex: 1, minHeight: 53, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 7 },
  mapModeText: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.3 },
  mapModeSubtext: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 2 },
  savedRouteCard: { gap: 10 },
  milestoneRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 3 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 15, lineHeight: 22 },
  small: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 4 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  matches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 7 },
  optionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recommended: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.1, marginBottom: 3 },
  metrics: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});

function isValidCoordinate(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat! >= -90 && lat! <= 90 && lng! >= -180 && lng! <= 180;
}
