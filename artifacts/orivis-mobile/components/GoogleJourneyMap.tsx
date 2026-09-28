import React, { useEffect, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

type HeatPoint = { lat: number; lng: number; intensity: number };
type ReportPoint = { lat: number; lng: number };

export function GoogleJourneyMap({
  lat,
  lng,
  destination,
  destinationLat,
  destinationLng,
  mode,
  routeId,
  heatPoints,
  reportPoints,
  onError,
}: {
  lat: number;
  lng: number;
  destination: string;
  destinationLat: number;
  destinationLng: number;
  mode: string;
  routeId: string;
  heatPoints: HeatPoint[];
  reportPoints: ReportPoint[];
  onError: () => void;
}) {
  // Serve the document from the API origin rather than from about:blank. The
  // separate Maps JavaScript key is restricted to this page's HTTP referrer.
  const url = useMemo(() => {
    const query = new URLSearchParams({
      lat: String(lat), lng: String(lng), destination, mode, routeId,
    });
    query.set('destinationLat', String(destinationLat));
    query.set('destinationLng', String(destinationLng));
    const heat = heatPoints.slice(0, 80)
      .map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${p.intensity.toFixed(2)}`).join(';');
    if (heat) query.set('heat', heat);
      const reports = reportPoints.slice(0, 80)
        .map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
      if (reports) query.set('reports', reports);
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/journey/map-3d?${query.toString()}`;
  }, [lat, lng, destination, destinationLat, destinationLng, mode, routeId, heatPoints, reportPoints]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin === new URL(url).origin && event.data === 'orivis-map-error') onError();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [url, onError]);

  return (
    <View testID="journey-google-map" style={styles.container}>
      {Platform.OS === 'web' ? (
        <iframe
          src={url}
          title="Interactive Google 3D journey map"
          style={{ width: '100%', height: '100%', border: 0 }}
          onError={onError}
        />
      ) : (
        <WebView
          source={{ uri: url }}
          style={styles.map}
          javaScriptEnabled
          scrollEnabled={false}
          onError={onError}
          onMessage={event => { if (event.nativeEvent.data === 'orivis-map-error') onError(); }}
          accessibilityLabel="Interactive Google 3D journey map"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 255, borderRadius: 22, overflow: 'hidden' },
  map: { flex: 1, backgroundColor: 'transparent' },
});