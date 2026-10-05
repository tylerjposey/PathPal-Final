import assert from "node:assert/strict";
import { test } from "node:test";
import { applySeriousHazardReviewRule } from "../src/lib/report-assessment-rules.ts";
import type { ReportAiSuggestion } from "../src/lib/openai-assistance.ts";

const modelFixture: ReportAiSuggestion = {
  suggestedCategory: "Other concerns",
  summary: "A concern needs follow-up.",
  suggestedSeverity: 4,
  suggestedPriority: "Low",
  urgency: "routine",
  evidenceQuality: "limited",
  evidence: [{ source: "report_text", detail: "The description mentions a hazard." }],
  uncertainty: "Current conditions are not confirmed.",
  conflicts: [],
  missingFacts: ["Whether the hazard is active."],
  recommendedDepartment: "Environmental Services",
  urgentHumanReview: false,
};

const cases = [
  {
    name: "minor sidewalk defect stays separate from urgency",
    text: "A small sidewalk crack has been here for several months and no one is injured.",
    expectedSeverity: 4,
    expectedUrgency: "routine",
    expectedReview: false,
  },
  {
    name: "plausible fire is raised to urgent review despite limited evidence",
    text: "A fire is visible in the unattended trash container; please verify whether it is still burning.",
    expectedSeverity: 8,
    expectedUrgency: "urgent_review",
    expectedReview: true,
  },
  {
    name: "exposed electrical wiring is raised to urgent review",
    text: "Exposed electrical wires hang from a damaged cabinet beside the walkway.",
    expectedSeverity: 8,
    expectedUrgency: "urgent_review",
    expectedReview: true,
  },
  {
    name: "active falling material is raised to urgent review",
    text: "Falling debris is coming from the loose overhead panel above the sidewalk.",
    expectedSeverity: 8,
    expectedUrgency: "urgent_review",
    expectedReview: true,
  },
  {
    name: "explicitly negated serious hazard is not escalated",
    text: "There is no fire and no exposed wires; this is a small pavement crack.",
    expectedSeverity: 4,
    expectedUrgency: "routine",
    expectedReview: false,
  },
] as const;

test("synthetic report assessments preserve independent severity, urgency, and evidence quality", () => {
  for (const scenario of cases) {
    const baseline = {
      severity: modelFixture.suggestedSeverity,
      priority: modelFixture.suggestedPriority,
    };
    const { suggestion, adjustments } = applySeriousHazardReviewRule(modelFixture, scenario.text);
    assert.deepEqual(baseline, { severity: 4, priority: "Low" }, `${scenario.name}: legacy baseline`);
    assert.equal(suggestion.suggestedSeverity, scenario.expectedSeverity, scenario.name);
    assert.equal(suggestion.urgency, scenario.expectedUrgency, scenario.name);
    assert.equal(suggestion.urgentHumanReview, scenario.expectedReview, scenario.name);
    assert.equal(suggestion.evidenceQuality, "limited", "The rule must not inflate evidence quality.");
    assert.equal(suggestion.missingFacts[0], "Whether the hazard is active.");
    if (scenario.expectedReview) {
      assert.ok(adjustments.length > 0, "Applied rules must be auditable.");
      assert.ok(adjustments.every((change) => change.source.startsWith("backend_rule:") && change.reason.length > 0));
    } else {
      assert.equal(adjustments.length, 0);
    }
  }
});

test("repeat selected hazard cases for deterministic stability", () => {
  for (const text of [
    "Flames are visible from a bin; current conditions are not confirmed.",
    "Live wires are exposed next to a public walkway.",
  ]) {
    const first = applySeriousHazardReviewRule(modelFixture, text);
    const repeat = applySeriousHazardReviewRule(modelFixture, text);
    assert.deepEqual(repeat, first);
    assert.equal(repeat.suggestion.urgency, "urgent_review");
    assert.ok(repeat.suggestion.suggestedSeverity >= 8);
  }
});