import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { getGetJourneyCatalogQueryKey, getGetJourneyMapQueryKey, useGetJourneyCatalog, useGetJourneyMap, type JourneyRoute } from '@workspace/api-client-react';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Field, ScreenHeader, SectionTitle } from '@/components/OrivisUI';
import { RouteMap } from '@/components/RouteMap';
import { useDemo } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';

const SAMPLE_ORIGIN = { lat: 37.3089, lng: -121.8982 };

export function JourneyScreen() {
  const colors = useColors();
  const { state, selectJourney } = useDemo();
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [origin, setOrigin] = useState(SAMPLE_ORIGIN);
  const [usingDeviceLocation, setUsingDeviceLocation] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [destination, setDestination] = useState(state.selectedJourney?.destination ?? 'River Glen Elementary, San Jose, CA');
  const [searchedDestination, setSearchedDestination] = useState(destination);
  const [search, setSearch] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setCatalogSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const catalogParams = { query: catalogSearch };
  const journeyParams = { ...origin, destination: searchedDestination };
  const catalog = useGetJourneyCatalog(catalogParams, { query: { queryKey: getGetJourneyCatalogQueryKey(catalogParams), staleTime: 15 * 60_000 } });
  const journey = useGetJourneyMap(
    journeyParams,
    { query: { queryKey: getGetJourneyMapQueryKey(journeyParams), enabled: searchedDestination.length > 0, staleTime: 60_000, retry: 1 } },
  );
  const offlineRoute: JourneyRoute = {
    id: 'offline-route', name: 'Demo transit option', startStop: 'Sample stop · Willow Glen',
    destinationStop: searchedDestination, durationMinutes: 30, walkingMeters: 350,
    transfers: 0, delayMinutes: 0, alerts: [], available: true, recommended: true, source: 'demo',
  };
  const routes = journey.data?.routes ?? (journey.isError ? [offlineRoute] : []);
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? routes.find((route) => route.recommended) ?? routes[0];
  const mapUrl = journey.data?.mapImageUrl;
  useEffect(() => setMapFailed(false), [mapUrl, selectedRouteId, searchedDestination, origin.lat, origin.lng]);
  const mapPath = mapUrl && selectedRoute?.polyline
    ? `${mapUrl.split('&routePolyline=')[0]}&routePolyline=${encodeURIComponent(selectedRoute.polyline)}`
    : mapUrl;
  const imageUrl = mapPath
    ? `${Platform.OS === 'web' && !process.env.EXPO_PUBLIC_DOMAIN ? '' : `https://${process.env.EXPO_PUBLIC_DOMAIN}`}${mapPath}`
    : null;

  const locate = async () => {
    setLocationError('');
    try {
      const access = permission?.granted ? permission : await requestPermission();
      if (!access.granted) {
        setLocationError('Location access was not granted. You can keep using the sample start point.');
        return;
      }
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setOrigin({ lat: result.coords.latitude, lng: result.coords.longitude });
      setUsingDeviceLocation(true);
      setSelectedRouteId(null);
    } catch {
      setLocationError('Location is unavailable. You can still plan a journey from the sample start point.');
    }
  };

  const chooseRoute = (route: JourneyRoute) => {
    selectJourney({
      id: route.id,
      name: route.name,
      startStop: route.startStop,
      destinationStop: route.destinationStop,
      destination: searchedDestination,
      durationMinutes: route.durationMinutes,
      walkingMeters: route.walkingMeters,
      transfers: route.transfers,
      delayMinutes: route.delayMinutes,
      alerts: route.alerts,
      source: route.source,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <ScreenHeader eyebrow="Journey planner" title="Find a better way there" subtitle="Live transit options when available. Your location is used only while planning, never tracked in the background." />
      <Card tone="soft">
        <View style={styles.infoRow}>
          <Feather name="map-pin" size={20} color={colors.primary} />
          <View style={styles.flex}>
            <Text style={[styles.title, { color: colors.foreground }]}>{usingDeviceLocation ? 'Using your current position' : 'Sample start · Willow Glen, San Jose'}</Text>
            <Text style={[styles.small, { color: colors.mutedForeground }]}>Location helps identify nearby stops and recommend routes. It is not used on other pages or saved with your journey.</Text>
          </View>
        </View>
        <Button label="Use My Location · Find Nearby Stops" icon="navigation" onPress={() => { void locate(); }} testID="use-my-location" />
        {locationError ? <Text style={[styles.small, { color: colors.destructive }]}>{locationError}</Text> : null}
        {permission?.status === 'denied' && !permission.canAskAgain && Platform.OS !== 'web' ? (
          <Button label="Open location settings" icon="settings" variant="secondary" onPress={() => { void Linking.openSettings().catch(() => setLocationError('Unable to open settings.')); }} />
        ) : null}
      </Card>

      <SectionTitle title="Where are you going?" />
      <Field label="Child’s destination" value={destination} onChangeText={setDestination} placeholder="Search for a school or address" returnKeyType="search" onSubmitEditing={() => { if (destination.trim()) { setSearchedDestination(destination.trim()); setSelectedRouteId(null); } }} testID="journey-destination" />
      <Button label="Find routes" icon="search" onPress={() => { if (destination.trim()) { setSearchedDestination(destination.trim()); setSelectedRouteId(null); } }} testID="find-routes" />
      <Field label="Search bus routes and stops" value={search} onChangeText={setSearch} placeholder="Route number or stop name" testID="search-stops" />
      {catalog.isFetching && !catalog.data ? <ActivityIndicator color={colors.primary} /> : null}
      {catalog.data?.source === 'demo' ? <Text style={[styles.small, { color: colors.mutedForeground }]}>{catalog.data.message ?? 'Stop catalog unavailable; sample data shown.'}</Text> : null}
      {catalog.data && catalogSearch ? (
        <View style={styles.matches}>
          {catalog.data.routes.slice(0, 5).map((name, index) => <Chip key={`${name}-${index}`} label={name} onPress={() => setSearch(name)} />)}
          {catalog.data.stops.slice(0, 5).map((stop) => <Chip key={stop.id} label={stop.name} onPress={() => { setDestination(stop.name); setSearchedDestination(stop.name); setSelectedRouteId(null); }} />)}
          {!catalog.data.routes.length && !catalog.data.stops.length ? <Text style={[styles.small, { color: colors.mutedForeground }]}>No matching routes or stops found.</Text> : null}
        </View>
      ) : null}

      <SectionTitle title="Map & nearby stops" />
      {imageUrl && journey.data?.source === 'live' && !mapFailed ? (
        <Image source={{ uri: imageUrl }} style={styles.map} contentFit="cover" accessibilityLabel="Google map of the selected transit route" onError={() => setMapFailed(true)} />
      ) : <RouteMap height={255} />}
      <Text style={[styles.caption, { color: colors.mutedForeground }]}>{journey.data?.source === 'live' && imageUrl && !mapFailed ? 'Map imagery: Google Maps · route information: Google Maps and 511 SF Bay' : 'Illustrative demo map · not live position tracking'}</Text>
      {journey.isFetching && !journey.data ? <ActivityIndicator color={colors.primary} /> : null}
      {journey.isError ? <Text style={[styles.small, { color: colors.destructive }]}>Live routes are unavailable. Showing an illustrative demo option; tap Refresh to retry.</Text> : null}
      {journey.data?.message ? <Text style={[styles.small, { color: colors.mutedForeground }]}>{journey.data.message}</Text> : null}
      <Card>
        <Text style={[styles.title, { color: colors.foreground }]}>Nearest available bus stop</Text>
        <Text style={[styles.small, { color: colors.mutedForeground }]}>{journey.data?.nearestStop?.name ?? (journey.isError ? 'Unavailable offline · demo start only' : 'Search for routes to find nearby stops')}{journey.data?.nearestStop?.distanceMeters != null ? ` · ${Math.round(journey.data.nearestStop.distanceMeters)} m away` : ''}</Text>
        <Text style={[styles.small, { color: colors.mutedForeground }]}>Destination stop options: {[...new Set(routes.map((route) => route.destinationStop))].join(' · ') || 'Search for routes first'}</Text>
      </Card>

      <SectionTitle title="Route options" action="Refresh" onAction={() => { void journey.refetch(); void catalog.refetch(); }} />
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
          <Text style={[styles.small, { color: route.delayMinutes ? colors.warning : colors.mutedForeground }]}>{route.delayMinutes ? `${route.delayMinutes} min delay` : 'No reported delay'} · {route.available ? 'Available' : 'Unavailable'} · {route.source === 'live' ? 'Live option' : 'Demo fallback'}</Text>
          {route.alerts.map((alert, index) => <Text key={`${index}-${alert}`} style={[styles.small, { color: colors.warning }]}>Service alert: {alert}</Text>)}
        </Pressable>
      ))}
      {selectedRoute ? <Button label={state.selectedJourney?.id === selectedRoute.id && state.selectedJourney?.destination === searchedDestination && state.selectedJourney?.startStop === selectedRoute.startStop && state.selectedJourney?.source === selectedRoute.source ? 'Selected journey' : 'Choose this route'} icon="check" onPress={() => chooseRoute(selectedRoute)} disabled={!selectedRoute.available} testID="choose-route" /> : null}
      {journey.data?.alerts.length ? (
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
  title: { fontFamily: 'Inter_700Bold', fontSize: 15, lineHeight: 22 },
  small: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 4 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  map: { width: '100%', height: 255, borderRadius: 22 },
  matches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 7 },
  optionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recommended: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.1, marginBottom: 3 },
  metrics: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});