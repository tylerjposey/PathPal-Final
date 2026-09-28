import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export type JourneyMapLeg = {
  type: 'walk' | 'bus';
  polyline: string | null;
  boardingStop: { name: string; lat: number; lng: number };
  alightingStop: { name: string; lat: number; lng: number };
};
type HeatPoint = { lat: number; lng: number; intensity: number };

const LEG_COLORS = {
  walk: '#64748B',
  bus: ['#1565C0', '#EF6C00', '#8E24AA', '#2E7D32', '#C62828'],
};

// Leaflet + OpenStreetMap tiles provide pan/zoom without exposing a server key.
function buildMapHtml(
  legs: JourneyMapLeg[], heatPoints: HeatPoint[], fallbackLat: number, fallbackLng: number,
): string {
  let busIndex = 0;
  const linesJs = legs
    .map((leg) => {
      const color = leg.type === 'walk' ? LEG_COLORS.walk : LEG_COLORS.bus[(busIndex++) % LEG_COLORS.bus.length];
      return JSON.stringify({
        polyline: leg.polyline,
        color,
        dashed: leg.type === 'walk',
        boarding: leg.boardingStop,
        alighting: leg.alightingStop,
        type: leg.type,
      });
    })
    .join(',')
    .replace(/</g, '\\u003c');
  const heatJs = JSON.stringify(heatPoints).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #E5E7EB; }
    .stop-label { font-family: -apple-system, sans-serif; font-size: 11px; font-weight: 600; white-space: nowrap; }
    .map-error { padding: 24px; font: 14px -apple-system, sans-serif; color: #334155; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
  <script>
    // Standard Google/OSRM encoded-polyline decoder.
    function decodePolyline(str) {
      let index = 0, lat = 0, lng = 0, coordinates = [];
      while (index < str.length) {
        let result = 0, shift = 0, b;
        do {
          if (index >= str.length || shift > 30) return [];
          b = str.charCodeAt(index++) - 63;
          if (b < 0 || b > 63) return [];
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);
        result = 0; shift = 0;
        do {
          if (index >= str.length || shift > 30) return [];
          b = str.charCodeAt(index++) - 63;
          if (b < 0 || b > 63) return [];
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        lng += (result & 1) ? ~(result >> 1) : (result >> 1);
        const point = [lat * 1e-5, lng * 1e-5];
        if (!Number.isFinite(point[0]) || point[0] < -90 || point[0] > 90 ||
            !Number.isFinite(point[1]) || point[1] < -180 || point[1] > 180) return [];
        coordinates.push(point);
      }
      return coordinates;
    }

    if (typeof L === 'undefined') {
      document.getElementById('map').innerHTML =
        '<div class="map-error">Map tiles are unavailable. Follow the journey steps listed below.</div>';
    } else {
    const legs = [${linesJs}];
    const map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const heatPoints = ${heatJs};
    if (heatPoints.length) {
      if (L.heatLayer) {
        L.heatLayer(heatPoints.map(p => [p.lat, p.lng, p.intensity]), {
          radius: 24, blur: 18, maxZoom: 16,
          gradient: { 0.2: '#E9C94B', 0.6: '#E99A3C', 1: '#D74F48' }
        }).addTo(map);
      } else {
        heatPoints.forEach(p => L.circle([p.lat, p.lng], {
          radius: 45, color: '#D74F48', opacity: 0, fillOpacity: 0.25
        }).addTo(map));
      }
    }
    map.on('click', event => {
      L.popup().setLatLng(event.latlng)
        .setContent('Map location: ' + event.latlng.lat.toFixed(5) + ', ' + event.latlng.lng.toFixed(5))
        .openOn(map);
    });

    const allBounds = [];
    const stopKeys = new Set();
    const validStop = stop =>
      stop &&
      Number.isFinite(stop.lat) && stop.lat >= -90 && stop.lat <= 90 &&
      Number.isFinite(stop.lng) && stop.lng >= -180 && stop.lng <= 180;
    legs.forEach((leg) => {
      const decodedPoints = leg.polyline ? decodePolyline(leg.polyline) : [];
      const exactGeometry = decodedPoints.length > 1;
      const canApproximate =
        !exactGeometry &&
        validStop(leg.boarding) &&
        validStop(leg.alighting) &&
        (Math.abs(leg.boarding.lat - leg.alighting.lat) > 1e-6 ||
          Math.abs(leg.boarding.lng - leg.alighting.lng) > 1e-6);
      const points = exactGeometry
        ? decodedPoints
        : canApproximate
          ? [[leg.boarding.lat, leg.boarding.lng], [leg.alighting.lat, leg.alighting.lng]]
          : [];
      if (points.length > 1) {
        L.polyline(points, {
          color: exactGeometry ? leg.color : '#64748B',
          weight: exactGeometry ? leg.type === 'bus' ? 5 : 4 : 3,
          opacity: exactGeometry ? 0.9 : 0.68,
          dashArray: exactGeometry ? leg.dashed ? '2 8' : null : '7 8',
        }).addTo(map);
        points.forEach((p) => allBounds.push(p));
      }
      [leg.boarding, leg.alighting].forEach((stop) => {
        if (!validStop(stop)) return;
        const key = stop.lat.toFixed(5) + ',' + stop.lng.toFixed(5);
        if (stopKeys.has(key)) return;
        stopKeys.add(key);
        const isBus = leg.type === 'bus';
        const marker = L.circleMarker([stop.lat, stop.lng], {
          radius: isBus ? 7 : 5,
          color: '#fff',
          weight: 2,
          fillColor: leg.color,
          fillOpacity: 1,
        }).addTo(map);
        marker.bindTooltip(stop.name, { direction: 'top', className: 'stop-label' });
        allBounds.push([stop.lat, stop.lng]);
      });
    });

    if (allBounds.length) {
      map.fitBounds(allBounds, { padding: [28, 28] });
    } else {
      map.setView([${fallbackLat}, ${fallbackLng}], 14);
    }
    }
  </script>
</body>
</html>`;
}

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
