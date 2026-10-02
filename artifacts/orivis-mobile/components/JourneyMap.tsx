import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildMapHtml, type HeatPoint, type JourneyMapLeg } from './JourneyMapHtml';

export type { JourneyMapLeg } from './JourneyMapHtml';

/**
 * Interactive route map rendered with Leaflet + OpenStreetMap tiles inside a
 * WebView. Deliberately avoids any Google Maps client-side SDK: this
 * project's GOOGLE_MAPS_API_KEY is an unrestricted server key and must never
 * be shipped to a client bundle. OSM tiles need no key at all.
 */
export function JourneyMap({
  legs,
  heatPoints = [],
  fallbackLat,
  fallbackLng,
  height = 255,
}: {
  legs: JourneyMapLeg[];
  heatPoints?: HeatPoint[];
  fallbackLat: number;
  fallbackLng: number;
  height?: number;
}) {
  const html = useMemo(() => buildMapHtml(legs, heatPoints, fallbackLat, fallbackLng), [legs, heatPoints, fallbackLat, fallbackLng]);

  if (Platform.OS === 'web') {
    return (
      <View testID="journey-2d-map" style={[styles.container, { height }]}>
        <iframe
          srcDoc={html}
          style={{ width: '100%', height: '100%', border: 0 }}
          title="Journey route map"
        />
      </View>
    );
  }

  return (
    <View testID="journey-2d-map" style={[styles.container, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled
        accessibilityLabel="Interactive map of the selected transit route"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', borderRadius: 22, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
