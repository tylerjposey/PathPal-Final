import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildMapHtml } from '../components/JourneyMapHtml.ts';

function executeMapScript(legs) {
  const html = buildMapHtml(legs, [], 37.3382, -121.8863);
  const inlineScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((script) => script.trim());
  assert.ok(inlineScript, 'the map HTML should include its rendering script');

  const drawnLines = [];
  const markers = [];
  const layer = { addTo() { return this; } };
  const marker = {
    addTo() { return this; },
    bindTooltip() { return this; },
  };
  const map = {
    on() {},
    fitBounds() {},
    setView() {},
  };
  const L = {
    map() { return map; },
    tileLayer() { return layer; },
    polyline(points) {
      drawnLines.push(points);
      return layer;
    },
    circleMarker(point) {
      markers.push(point);
      return marker;
    },
  };

  vm.runInNewContext(inlineScript, {
    L,
    document: { getElementById: () => ({ innerHTML: '' }) },
  });
  return { drawnLines, markers };
}

const busLeg = {
  type: 'bus',
  boardingStop: { name: 'Diridon', lat: 37.329, lng: -121.902 },
  alightingStop: { name: 'Downtown', lat: 37.338, lng: -121.886 },
};

test('a bus leg without provider geometry shows stops but draws no connector', () => {
  const { drawnLines, markers } = executeMapScript([{ ...busLeg, polyline: null }]);

  assert.deepEqual(drawnLines, []);
  assert.deepEqual(JSON.parse(JSON.stringify(markers)), [
    [37.329, -121.902],
    [37.338, -121.886],
  ]);
});

test('a bus leg with provider geometry draws the decoded route shape', () => {
  const { drawnLines } = executeMapScript([{
    ...busLeg,
    polyline: 'oq{bFnz|fVgEgE',
  }]);

  assert.equal(drawnLines.length, 1);
  const renderedPoints = JSON.parse(JSON.stringify(drawnLines[0]));
  const expectedPoints = [
    [37.338, -121.886],
    [37.339, -121.885],
  ];
  assert.equal(renderedPoints.length, expectedPoints.length);
  renderedPoints.forEach((point, index) => {
    assert.ok(Math.abs(point[0] - expectedPoints[index][0]) < 1e-6);
    assert.ok(Math.abs(point[1] - expectedPoints[index][1]) < 1e-6);
  });
});