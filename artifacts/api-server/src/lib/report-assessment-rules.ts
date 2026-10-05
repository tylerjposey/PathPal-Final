import type { ReportAiSuggestion, ReportRuleAdjustment } from "./openai-assistance";

type SeriousHazard = { label: string; pattern: RegExp };

const seriousHazards: SeriousHazard[] = [
  { label: "fire", pattern: /\b(?:active\s+)?(?:fire|flames?|burning)\b/i },
  {
    label: "exposed electrical hazard",
    pattern: /\b(?:exposed\s+(?:electrical\s+)?wires?|live\s+wires?|sparking\s+(?:wire|wires|electrical)|exposed\s+electrical\s+(?:hazard|wiring))\b/i,
  },
  {
    label: "actively falling material",
    pattern: /\b(?:actively\s+falling|falling\s+(?:debris|material|objects?)|about\s+to\s+fall|loose\s+(?:debris|material|objects?)\s+(?:overhead|above))\b/i,
  },
];

function isExplicitlyNegated(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 45), index);
  return /\b(?:no|not|never|without)\s+(?:(?:there\s+)?(?:is|are|was|were)\s+)?(?:an?\s+)?(?:active\s+)?$/i.test(prefix);
}

function priorityForSeverity(severity: number): ReportAiSuggestion["suggestedPriority"] {
  return severity >= 8 ? "High" : severity >= 5 ? "Medium" : "Low";
}

export function applySeriousHazardReviewRule(
  original: ReportAiSuggestion,
  description: string,
): { suggestion: ReportAiSuggestion; adjustments: ReportRuleAdjustment[] } {
  const hazard = seriousHazards
    .map((candidate) => ({ ...candidate, match: candidate.pattern.exec(description) }))
    .find((candidate) => candidate.match && !isExplicitlyNegated(description, candidate.match.index));
  if (!hazard) return { suggestion: original, adjustments: [] };

  const reason =
    `The report text includes a plausible ${hazard.label} cue. Keep potential severity high and require urgent human review; missing or unverified facts affect confidence, not the potential consequence.`;
  const source = "backend_rule:serious-hazard-floor-v1";
  const suggestion = { ...original };
  const adjustments: ReportRuleAdjustment[] = [];
  const set = <K extends ReportRuleAdjustment["field"]>(
    field: K,
    beforeValue: ReportAiSuggestion[K],
    afterValue: ReportAiSuggestion[K],
  ) => {
    if (beforeValue === afterValue) return;
    (suggestion[field] as ReportAiSuggestion[K]) = afterValue;
    adjustments.push({ field, source, reason, beforeValue, afterValue });
  };

  set("suggestedSeverity", suggestion.suggestedSeverity, Math.max(8, suggestion.suggestedSeverity));
  set("suggestedPriority", suggestion.suggestedPriority, priorityForSeverity(suggestion.suggestedSeverity));
  set("urgency", suggestion.urgency, "urgent_review");
  set("urgentHumanReview", suggestion.urgentHumanReview, true);
  return { suggestion, adjustments };
}