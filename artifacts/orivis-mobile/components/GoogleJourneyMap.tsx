import React, { useEffect, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

type HeatPoint = { lat: number; lng: number; intensity: number };

export function GoogleJourneyMap({
  lat, lng, destination, mode, routeId, heatPoints, onError,
}: {
  lat: number;
  lng: number;
  destination: string;
  mode: string;
  routeId: string;
  heatPoints: HeatPoint[];
  onError: () => void;
}) {
  // Serve the document from the API origin rather than from about:blank. The
  // separate Maps JavaScript key is restricted to this page's HTTP referrer.
  const url = useMemo(() => {
    const query = new URLSearchParams({
      lat: String(lat), lng: String(lng), destination, mode, routeId,
    });
    const heat = heatPoints.slice(0, 80)
      .map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${p.intensity.toFixed(2)}`).join(';');
    if (heat) query.set('heat', heat);
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/journey/map-3d?${query.toString()}`;
  }, [lat, lng, destination, mode, routeId, heatPoints]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin === new URL(url).origin && event.data === 'orivis-map-error') onError();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [url, onError]);

  return (
    <View style={styles.container}>
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