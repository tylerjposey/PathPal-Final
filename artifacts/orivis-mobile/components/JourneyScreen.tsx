import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { getGetJourneyMapQueryKey, useGetJourneyMap, type JourneyRoute, type TravelModeParameter } from '@workspace/api-client-react';
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, ScreenHeader, SectionTitle } from '@/components/OrivisUI';
import { GoogleJourneyMap } from '@/components/GoogleJourneyMap';
import { LocationAutocompleteField, type SelectedPlace } from '@/components/LocationAutocompleteField';
import { heatScore, useDemo } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';

const MODE_OPTIONS: { value: TravelModeParameter; label: string }[] = [
  { value: 'any', label: 'Best option' },
  { value: 'transit', label: 'Bus only' },
  { value: 'walking', label: 'Walking only' },
];

export function JourneyScreen() {
  const colors = useColors();
  const { state, selectJourney } = useDemo();
  const [permission, requestPermission] = Location.useForegroundPermissions();
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
  const [showHeat, setShowHeat] = useState(false);
  const [googleMapFailed, setGoogleMapFailed] = useState(false);
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
    { query: { queryKey: getGetJourneyMapQueryKey(journeyParams), enabled: searchRequested && endpointsSelected, staleTime: 60_000, retry: 1 } },
  );
  const routes = searchRequested ? journey.data?.routes ?? [] : [];
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? routes.find((route) => route.recommended) ?? routes[0];
  const canUseGoogleMap = searchRequested && !!journey.data?.map3dAvailable && !googleMapFailed;
  const geocodedReports = state.reports.filter((report) =>
    report.latitude != null && report.longitude != null &&
    Number.isFinite(report.latitude) && Number.isFinite(report.longitude));
  const reportPoints = geocodedReports.slice(0, 80).map((report) => ({
    lat: report.latitude!, lng: report.longitude!,
  }));
  const heatPoints = showHeat ? geocodedReports.map((report) => ({
    lat: report.latitude!, lng: report.longitude!,
    intensity: Math.min(1, Math.max(0.2, heatScore(report, geocodedReports) / 12)),
  })) : [];

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
    } catch {
      setLocationError('Location is unavailable. Select a starting place instead.');
    }
  };

  const chooseRoute = (route: JourneyRoute) => {
    selectJourney({
      id: route.id,
      name: route.name,
      startStop: route.startStop,
      destinationStop: route.destinationStop,
      destination: searchedDestination,
      startingLocation: origin?.name ?? '',
      originLatitude: origin?.lat ?? 0,
      originLongitude: origin?.lng ?? 0,
      ...(destinationCoordinates
        ? {
          destinationLatitude: destinationCoordinates.lat,
          destinationLongitude: destinationCoordinates.lng,
        }
        : {}),
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
    });
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
          }}
          onSelect={(place) => {
            setOrigin(place);
            setOriginText(place.name);
            setUsingDeviceLocation(false);
            setSearchRequested(false);
            setGoogleMapFailed(false);
            setLocationError('');
            setSelectedRouteId(null);
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
          }}
          onSelect={(place) => {
            setDestination(place.name);
            setDestinationCoordinates(place);
            setSearchRequested(false);
            setGoogleMapFailed(false);
            setSelectedRouteId(null);
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

      <SectionTitle title="Google Maps" />
      <Chip label={showHeat ? 'Hide safety heat map' : 'Show safety heat map'} active={showHeat} onPress={() => setShowHeat(!showHeat)} />
      {searchRequested && journey.isFetching && !journey.data ? (
        <View style={[styles.mapPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.small, { color: colors.mutedForeground }]}>Loading journey map…</Text>
        </View>
      ) : canUseGoogleMap ? (
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
          onError={() => setGoogleMapFailed(true)}
        />
      ) : (
        <View
          testID={searchRequested ? 'journey-google-map-unavailable' : 'journey-map-empty'}
          style={[styles.mapPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name={searchRequested ? 'alert-triangle' : 'map-pin'} size={22} color={searchRequested ? colors.warning : colors.primary} />
          <Text style={[styles.small, { color: colors.mutedForeground, textAlign: 'center' }]}>
            {!searchRequested
              ? 'Select both places and tap Find routes to load Google Maps.'
              : journey.isError
                ? 'Journey data is unavailable. Refresh to try again.'
                : googleMapFailed
                  ? 'Google Maps could not load this route. Check the map setup and try again.'
                  : 'Google Maps is unavailable for this journey.'}
          </Text>
        </View>
      )}
      {canUseGoogleMap ? (
        <Text style={[styles.caption, { color: colors.mutedForeground }]}>
          Google Maps · selected route, stops, destination, reports, and safety heat map.
        </Text>
      ) : null}
      {showHeat && !geocodedReports.length ? <Text style={[styles.caption, { color: colors.mutedForeground }]}>No reports with map locations are available to display.</Text> : null}
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
        <Pressable key={route.id} testID={`route-${route.id}`} onPress={() => setSelectedRouteId(route.id)} style={[styles.option, { backgroundColor: colors.card, borderColor: selectedRoute?.id === route.id ? colors.primary : colors.border }]}>
          <View style={styles.optionHeading}>
            <View style={styles.flex}>
              {route.recommended ? <Text style={[styles.recommended, { color: colors.primary }]}>RECOMMENDED ROUTE</Text> : null}
              <Text style={[styles.title, { color: colors.foreground }]}>{route.name}</Text>
            </View>
            <Feather name={selectedRoute?.id === route.id ? 'check-circle' : 'circle'} size={20} color={colors.primary} />
          </View>
          <Text style={[styles.small, { color: colors.mutedForeground }]}>{route.startStop} → {route.destinationStop}</Text>
          <Text style={[styles.metrics, { color: colors.foreground }]}>{route.durationMinutes} min · {route.walkingMeters} m walk · {route.transfers} transfer{route.transfers === 1 ? '' : 's'}</Text>
           <Text style={[styles.small, { color: route.delayMinutes ? colors.warning : colors.mutedForeground }]}>{route.delayMinutes ? `${route.delayMinutes} min delay` : route.mode === 'transit' && route.source === 'live' && route.legs.filter((leg) => leg.type === 'bus').every((leg) => leg.delayMinutes === null) ? 'Live delay unknown' : 'No reported delay'} · {route.available ? 'Available' : 'Cannot catch this connection'} · {route.source === 'live' ? route.mode === 'walking' ? 'Google walking estimate' : '511 VTA scheduled bus' : 'Demo fallback'}</Text>
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
      {selectedRoute ? <Button label={state.selectedJourney?.id === selectedRoute.id && state.selectedJourney?.destination === searchedDestination && state.selectedJourney?.startStop === selectedRoute.startStop && state.selectedJourney?.source === selectedRoute.source ? 'Selected journey' : 'Choose this route'} icon="check" onPress={() => chooseRoute(selectedRoute)} disabled={!selectedRoute.available} testID="choose-route" /> : null}
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
  title: { fontFamily: 'Inter_700Bold', fontSize: 15, lineHeight: 22 },
  small: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 4 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  matches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 7 },
  optionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recommended: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.1, marginBottom: 3 },
  metrics: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});