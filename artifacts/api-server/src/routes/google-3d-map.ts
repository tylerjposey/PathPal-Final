type Stop = { name: string; lat: number; lng: number };
type Leg = {
  type: "walk" | "bus";
  polyline: string | null;
  boardingStop: Stop;
  alightingStop: Stop;
  routeNumber: string | null;
};
export type HeatPoint = { lat: number; lng: number; intensity: number };

export function parseHeatPoints(value: unknown): HeatPoint[] | undefined {
  if (value === undefined) return [];
  if (typeof value !== "string" || value.length > 3200) return undefined;
  if (!value) return [];
  const rows = value.split(";");
  if (rows.length > 80) return undefined;
  const points: HeatPoint[] = [];
  for (const row of rows) {
    const fields = row.split(",");
    if (fields.length !== 3 || fields.some((field) => !/^-?\d+(?:\.\d+)?$/.test(field))) return undefined;
    const [lat, lng, intensity] = fields.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(intensity) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180 || intensity < 0 || intensity > 1) return undefined;
    points.push({ lat, lng, intensity });
  }
  return points;
}

const scriptData = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function renderGoogle3DMap(
  key: string, legs: Leg[], heat: HeatPoint[], fallback: { lat: number; lng: number },
): string {
  const routes = legs.map((leg, index) => ({
    polyline: leg.polyline, type: leg.type, routeNumber: leg.routeNumber,
    color: leg.type === "walk" ? "#64748B" : ["#1565C0", "#EF6C00", "#8E24AA", "#2E7D32", "#C62828"][index % 5],
    boarding: leg.boardingStop, alighting: leg.alightingStop,
  }));
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>Orivis journey map</title>
<style>
  html,body,#map { height:100%; width:100%; margin:0; background:#dce5e9; font:13px system-ui,sans-serif; }
  #notice { position:absolute; z-index:2; bottom:10px; left:10px; right:10px; padding:8px 10px;
    background:#fff; color:#18313b; border-radius:10px; box-shadow:0 1px 8px #0003; }
  #error { display:none; padding:25px; color:#18313b; }
</style></head><body>
<div id="map"></div>
<div id="notice">3D Google map · bus shapes from 511 · walks from Google Routes</div>
<div id="error" role="alert">Google 3D map could not load. Use the 2D map option to view the journey.</div>
<script>
  const routeLegs = ${scriptData(routes)};
  const heatPoints = ${scriptData(heat)};
  const fallback = ${scriptData(fallback)};
  function decode(str) {
    let i=0, lat=0, lng=0, points=[];
    while(i<str.length) {
      let b, shift=0, result=0;
      do { b=str.charCodeAt(i++)-63; result|=(b&31)<<shift; shift+=5; } while(b>=32);
      lat+=(result&1)?~(result>>1):(result>>1);
      shift=0; result=0;
      do { b=str.charCodeAt(i++)-63; result|=(b&31)<<shift; shift+=5; } while(b>=32);
      lng+=(result&1)?~(result>>1):(result>>1);
      points.push({lat:lat/1e5,lng:lng/1e5});
    }
    return points;
  }
  function showError() {
    document.getElementById('map').style.display='none';
    document.getElementById('notice').style.display='none';
    document.getElementById('error').style.display='block';
    if(window.parent !== window) window.parent.postMessage('orivis-map-error','*');
    if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage('orivis-map-error');
  }
  window.gm_authFailure = showError;
  window.initMap = async function() {
    try {
      if(!document.createElement('canvas').getContext('webgl2')) { showError(); return; }
      const {Map3DElement,Polyline3DElement,Marker3DElement,Polygon3DElement} =
        await google.maps.importLibrary('maps3d');
      const points = routeLegs.flatMap(l => l.polyline ? decode(l.polyline) : []);
      if (!points.length) points.push(fallback);
      const minLat=Math.min(...points.map(p=>p.lat)), maxLat=Math.max(...points.map(p=>p.lat));
      const minLng=Math.min(...points.map(p=>p.lng)), maxLng=Math.max(...points.map(p=>p.lng));
      const center={lat:(minLat+maxLat)/2,lng:(minLng+maxLng)/2,altitude:0};
      const span=Math.max((maxLat-minLat)*111000,(maxLng-minLng)*89000);
      const map = new Map3DElement({
        center, range:Math.max(800,Math.min(30000,span*2.2)), tilt:55, heading:0, mode:'HYBRID'
      });
      map.style.width='100%'; map.style.height='100%';
      document.getElementById('map').append(map);
      const markerKeys=new Set();
      routeLegs.forEach(leg => {
        const path=leg.polyline ? decode(leg.polyline) : [];
        if(path.length>1) {
          map.append(new Polyline3DElement({
            path, strokeColor:leg.color, outerColor:'#ffffff', strokeWidth:leg.type==='bus'?8:5,
            outerWidth:0.3, altitudeMode:'RELATIVE_TO_GROUND', drawsOccludedSegments:true,
          }));
        }
        for(const stop of [leg.boarding,leg.alighting]) {
          const id=stop.lat.toFixed(5)+','+stop.lng.toFixed(5);
          if(markerKeys.has(id)) continue;
          markerKeys.add(id);
          map.append(new Marker3DElement({
            position:{lat:stop.lat,lng:stop.lng,altitude:0},label:stop.name
          }));
        }
      });
      heatPoints.forEach(point => {
        const latRadius=45/111320, lngRadius=45/(111320*Math.max(0.1,Math.cos(point.lat*Math.PI/180)));
        const polygon=new Polygon3DElement({
          strokeColor:'#D74F4860',strokeWidth:1,
          fillColor:'#D74F48'+Math.round(40+Math.min(1,point.intensity)*110).toString(16).padStart(2,'0'),
          altitudeMode:'RELATIVE_TO_GROUND',drawsOccludedSegments:true,
        });
        polygon.path=Array.from({length:12},(_,i)=>({
          lat:point.lat+Math.sin(i*Math.PI/6)*latRadius,
          lng:point.lng+Math.cos(i*Math.PI/6)*lngRadius,
        }));
        map.append(polygon);
      });
      map.addEventListener('gmp-click', event => {
        if(event.position) {
          const {lat,lng}=event.position;
          document.getElementById('notice').textContent=
            'Map location: '+Number(lat).toFixed(5)+', '+Number(lng).toFixed(5);
        }
      });
    } catch (_) { showError(); }
  };
  setTimeout(() => { if(!document.querySelector('gmp-map-3d')) showError(); }, 15000);
</script>
<script async src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&libraries=maps3d&callback=initMap" onerror="showError()"></script>
</body></html>`;
}