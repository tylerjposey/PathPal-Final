import assert from "node:assert/strict";
import { test } from "node:test";
import { matchTransitAlerts, parseTransitAlerts } from "../src/lib/transit-alerts.ts";

const now = Date.parse("2026-10-04T18:00:00.000Z");
const fixture = {
  Header: { GtfsRealtimeVersion: "2.0" },
  Entities: [
    {
      Id: "provider-route-stop-1",
      Alert: {
        ActivePeriods: [{ start: Math.floor(now / 1000) - 60 }],
        InformedEntities: [{ routeId: "route-22", stopId: "stop-central" }],
        HeaderText: { Translations: [{ Text: "Route 22 delayed near Central." }] },
        Effect: "SIGNIFICANT_DELAYS",
      },
    },
    {
      Id: "provider-distinct-stop",
      Alert: {
        ActivePeriods: [{ start: Math.floor(now / 1000) - 60 }],
        InformedEntities: [{ stopId: "stop-north" }],
        HeaderText: { Translations: [{ Text: "Northbound stop closed." }] },
        Effect: "STOP_MOVED",
      },
    },
    {
      Id: "provider-until-further-notice",
      Alert: {
        InformedEntities: [],
        HeaderText: { Translations: [{ Text: "Service change until further notice." }] },
        Effect: "MODIFIED_SERVICE",
      },
    },
    {
      Id: "provider-other-route",
      Alert: {
        InformedEntities: [{ routeId: "route-220" }],
        HeaderText: { Translations: [{ Text: "Route 220 only." }] },
      },
    },
  ],
};

test("parses provider IDs, verbatim text, active periods, and unbounded notices", () => {
  const result = parseTransitAlerts(fixture, now);
  assert.equal(result.valid, true);
  assert.equal(result.alerts.length, 4);
  assert.equal(result.alerts[0]?.providerId, "provider-route-stop-1");
  assert.equal(result.alerts[0]?.originalText, "Route 22 delayed near Central.");
  assert.equal(result.alerts[0]?.activePeriods[0]?.end, null);
  assert.deepEqual(result.alerts[0]?.routeRefs, ["route-22"]);
  assert.deepEqual(result.alerts[0]?.stopRefs, ["stop-central"]);
  assert.equal(result.alerts[2]?.providerId, "provider-until-further-notice");
  assert.deepEqual(result.alerts[2]?.activePeriods, []);
});

test("expires old notices and requires exact route IDs while preserving distinct-stop notices", () => {
  const payload = {
    Entities: [
      ...fixture.Entities,
      {
        Id: "provider-expired",
        Alert: {
          ActivePeriods: [{ end: Math.floor(now / 1000) - 1 }],
          HeaderText: { Translations: [{ Text: "Old notice." }] },
        },
      },
    ],
  };
  const parsed = parseTransitAlerts(payload, now);
  const journeyAlerts = matchTransitAlerts(
    parsed.alerts,
    [{ routeId: "route-22", routeNumber: "22", routeName: "Rapid 22" }],
    [{ id: "stop-north", name: "Northbound stop" }],
    "2026-10-04T18:00:00.000Z",
  );
  assert.equal(journeyAlerts.some((alert) => alert.providerId === "provider-expired"), false);
  assert.equal(journeyAlerts.some((alert) => alert.providerId === "provider-other-route"), false);
  assert.equal(journeyAlerts.find((alert) => alert.providerId === "provider-route-stop-1")?.impact, "route_match");
  assert.equal(journeyAlerts.find((alert) => alert.providerId === "provider-distinct-stop")?.impact, "stop_match");
  assert.equal(journeyAlerts.find((alert) => alert.providerId === "provider-until-further-notice")?.impact, "uncertain");
});

test("expires old SIRI notices and keeps indefinite operator-wide notices as uncertain", () => {
  const payload = {
    Siri: {
      ServiceDelivery: {
        SituationExchangeDelivery: {
          Situations: {
            PtSituationElement: [
              {
                SituationNumber: "siri-expired",
                Summary: "Expired service notice.",
                ValidityPeriod: [{ EndTime: "2026-10-04T17:59:59.000Z" }],
              },
              {
                SituationNumber: "siri-indefinite",
                Summary: "Operator-wide notice.",
              },
            ],
          },
        },
      },
    },
  };
  const result = parseTransitAlerts(payload, now);
  assert.equal(result.valid, true);
  assert.deepEqual(result.alerts.map((alert) => alert.providerId), ["siri-indefinite"]);
  const matches = matchTransitAlerts(result.alerts, [], [], "2026-10-04T18:00:00.000Z");
  assert.equal(matches[0]?.impact, "uncertain");
});