import type { FieldworkPlanItem } from "./fieldworkCosts";
import { isFieldworkUnit } from "./fieldworkCosts";
import type { TopicDocument } from "./topicTypes";

/** Unités textuelles → clés fieldwork_plan. */
const TEXT_UNIT_TO_FIELD: Array<{
  re: RegExp;
  units: FieldworkPlanItem["unit"][];
}> = [
  {
    re: /entretiens?\s+collectifs?|entretiens?\s+de\s+groupe/i,
    units: ["group_interview"],
  },
  { re: /entretiens?/i, units: ["interview", "group_interview"] },
  { re: /documents?/i, units: ["document"] },
  {
    re: /s[eé]ances?(?:\s+d['’]?observation)?/i,
    units: ["observation_session"],
  },
  { re: /r[eé]pondants?/i, units: ["questionnaire_response"] },
  { re: /questionnaires?/i, units: ["questionnaire"] },
  { re: /bases?(?:\s+secondaires?)?/i, units: ["secondary_dataset"] },
];

const NUMBER_UNIT_RE =
  /(\d+)\s*(entretiens?(?:\s+collectifs?|\s+de\s+groupe)?|documents?|s[eé]ances?(?:\s+d['’]?observation)?|r[eé]pondants?|questionnaires?|bases?(?:\s+secondaires?)?)/gi;

function expectedQuantity(
  plan: FieldworkPlanItem[],
  units: FieldworkPlanItem["unit"][],
): number | null {
  let sum = 0;
  let found = false;
  for (const item of plan) {
    if (!isFieldworkUnit(item.unit)) continue;
    if (!units.includes(item.unit)) continue;
    const q = Number(item.quantity);
    if (!Number.isFinite(q) || q <= 0) continue;
    sum += q;
    found = true;
  }
  return found ? sum : null;
}

function matchUnits(unitText: string): FieldworkPlanItem["unit"][] | null {
  for (const entry of TEXT_UNIT_TO_FIELD) {
    if (entry.re.test(unitText)) return entry.units;
  }
  return null;
}

export type QuantityMismatch = {
  code: "PLAN_QUANTITY_MISMATCH";
  detail: string;
  found: number;
  expected: number;
  unitLabel: string;
};

/** Détecte un nombre + unité qui diffère de fieldwork_plan. */
export function findQuantityMismatches(
  text: string,
  fieldworkPlan: FieldworkPlanItem[] | undefined,
): QuantityMismatch[] {
  const plan = fieldworkPlan || [];
  if (!plan.length || !text) return [];
  const out: QuantityMismatch[] = [];
  const seen = new Set<string>();
  NUMBER_UNIT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_UNIT_RE.exec(text))) {
    const found = Number(m[1]);
    const unitLabel = m[2];
    const units = matchUnits(unitLabel);
    if (!units) continue;
    const expected = expectedQuantity(plan, units);
    if (expected == null) continue;
    if (found === expected) continue;
    const key = `${units.join("|")}:${found}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      code: "PLAN_QUANTITY_MISMATCH",
      detail: `Le texte mentionne ${found} ${unitLabel} alors que fieldwork_plan prévoit ${expected}.`,
      found,
      expected,
      unitLabel,
    });
  }
  return out;
}

export function documentPlainText(document: TopicDocument): string {
  const parts: string[] = [document.title || ""];
  for (const section of document.sections || []) {
    parts.push(section.heading || "");
    for (const p of section.paragraphs || []) parts.push(p);
    for (const b of section.bullets || []) parts.push(b);
    if (section.table) {
      parts.push(...(section.table.headers || []));
      for (const row of section.table.rows || []) parts.push(row.join(" "));
    }
  }
  if (document.workPlan?.phases) {
    for (const phase of document.workPlan.phases) {
      parts.push(
        phase.title,
        phase.objective,
        phase.deliverable,
        phase.checkpoint,
        phase.risk || "",
      );
    }
  }
  return parts.join("\n");
}

export function checkPlanQuantityMismatch(
  document: TopicDocument,
  fieldworkPlan: FieldworkPlanItem[] | undefined,
): QuantityMismatch | null {
  const hits = findQuantityMismatches(
    documentPlainText(document),
    fieldworkPlan,
  );
  return hits[0] || null;
}
