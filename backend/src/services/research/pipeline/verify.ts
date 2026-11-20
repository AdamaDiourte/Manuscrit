import {
  filterInterviewerQuotes,
  isInterviewMaterial,
  looksLikeInterviewerTurn,
} from "../../../../../shared/research/interviewMarkers";
import {
  materialText,
  materialTextBaseLength,
} from "../../../../../shared/research/project";
import type { ResearchUnit } from "../../../../../shared/research/units";
import type { PhaseRole } from "../../../../../shared/research/workPlan";
import type { CoverageRegistry } from "../jobs";
import type { Assignment } from "./assign";
import type { PlanSections, ThemeMap, UnitCard } from "./types";

export type Evidence = {
  id: string;
  quote: string;
  start: number;
  end: number;
  /** Présent si la citation vient d’une transcription vision automatique. */
  source?: "transcription-ia";
  /** Stance du claim d’origine (contre-exemple si contredit / nuance). */
  stance?: string;
};

export type PipelineSubsection = {
  title: string;
  thesis?: string;
  advice: string;
  evidence: Evidence[];
  themeIds?: string[];
  hypothesisIndexes?: number[];
  materialCount?: number;
  supportCount?: number;
};

export type PipelineSection = {
  title: string;
  advice: string;
  evidence: Evidence[];
  role?: PhaseRole;
  thesis?: string;
  themeIds?: string[];
  hypothesisIndexes?: number[];
  subsections?: PipelineSubsection[];
  materialCount?: number;
  supportCount?: number;
};

export type PipelineTheme = {
  themeId: string;
  label: string;
  description?: string;
  emergent?: boolean;
  fragile?: boolean;
  materialCount?: number;
};

/** Réexport pour le chemin synchrone (engine). */
export { looksLikeInterviewerTurn, filterInterviewerQuotes };

/**
 * Recalcule les offsets dans materialText(m) pour chaque quote retenue.
 * evidence.id = materialId (contrat / SourcePassageDialog).
 * Citations dans la zone vision (après la base) → source: "transcription-ia".
 * Quotes d’enquêteur identifiables → retirées (sauf seuil > 80 % → aborted).
 */
export function quotesToEvidence(
  quotes: string[],
  materialId: string,
  fullText: string,
  baseLength = fullText.length,
  stanceByQuote?: Map<string, string>,
  interviewerMarker?: string,
  /** Si false (matériau hors entretien), aucun filtrage enquêteur. */
  applyInterviewerFilter = true,
): { evidence: Evidence[]; interviewerFilterAborted: boolean } {
  const filtered = applyInterviewerFilter
    ? filterInterviewerQuotes(quotes, fullText, interviewerMarker)
    : {
        quotes: (quotes || []).filter((q) => q && q.length >= 3),
        aborted: false,
        rejectedCount: 0,
      };
  const out: Evidence[] = [];
  for (const quote of filtered.quotes) {
    if (!quote || quote.length < 3) continue;
    const start = fullText.indexOf(quote);
    if (start < 0) continue;
    const evidence: Evidence = {
      id: materialId,
      quote,
      start,
      end: start + quote.length,
    };
    if (start >= baseLength) evidence.source = "transcription-ia";
    const stance = stanceByQuote?.get(quote);
    if (stance) evidence.stance = stance;
    out.push(evidence);
  }
  return {
    evidence: out,
    interviewerFilterAborted: filtered.aborted,
  };
}

function stanceMapFromCards(
  cards: UnitCard[],
  materialId: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const card of cards) {
    if (card.materialId !== materialId) continue;
    for (const claim of card.claims || []) {
      if (claim.quote && claim.stance) map.set(claim.quote, claim.stance);
    }
  }
  return map;
}

function countMaterials(evidence: Evidence[]): number {
  return new Set(evidence.map((e) => e.id).filter(Boolean)).size;
}

function enrichCounts<
  T extends {
    evidence: Evidence[];
    materialCount?: number;
    supportCount?: number;
  },
>(block: T): T {
  block.supportCount = block.evidence.length;
  block.materialCount = countMaterials(block.evidence);
  return block;
}

function markerFor(
  materialId: string,
  markers: Map<string, string | undefined>,
): string | undefined {
  const m = markers.get(materialId);
  return m?.trim() || undefined;
}

export function buildVerifiedPlan(input: {
  plan: PlanSections;
  assignments: Assignment[];
  unused: Assignment[];
  coverage: CoverageRegistry;
  materials: unknown[];
  units: ResearchUnit[];
  cards: UnitCard[];
  hypotheses?: string[];
  themeMap?: ThemeMap;
}): {
  sections: PipelineSection[];
  gaps: string[];
  coverage: CoverageRegistry;
  themes: PipelineTheme[];
} {
  const textByMaterial = new Map<string, string>();
  const baseLenByMaterial = new Map<string, number>();
  const markersByMaterial = new Map<string, string | undefined>();
  const interviewByMaterial = new Map<string, boolean>();
  const materialTitles = new Map<string, string>();
  for (const raw of input.materials) {
    const m = raw as {
      id?: string;
      title?: string;
      type?: string;
      toolType?: string;
      collectionMode?: string;
      interviewerMarker?: string;
    };
    const id = String(m?.id || "");
    if (id) {
      textByMaterial.set(id, materialText(m));
      baseLenByMaterial.set(id, materialTextBaseLength(m));
      markersByMaterial.set(id, m.interviewerMarker);
      interviewByMaterial.set(id, isInterviewMaterial(m));
      if (m.title) materialTitles.set(id, m.title);
    }
  }
  // Unités peuvent aussi porter le marqueur / mode (après rechargement).
  for (const u of input.units || []) {
    if (!u.materialId) continue;
    if (u.interviewerMarker && !markersByMaterial.get(u.materialId))
      markersByMaterial.set(u.materialId, u.interviewerMarker);
    if (
      !interviewByMaterial.get(u.materialId) &&
      isInterviewMaterial({ collectionMode: u.collectionMode })
    )
      interviewByMaterial.set(u.materialId, true);
  }

  const abortedMaterials = new Set<string>();
  const noteAbort = (materialId: string, aborted: boolean) => {
    if (aborted) abortedMaterials.add(materialId);
  };

  const toEvidence = (
    quotes: string[],
    materialId: string,
    full: string,
    baseLen: number,
    stances?: Map<string, string>,
  ) => {
    const interview = interviewByMaterial.get(materialId) === true;
    const result = quotesToEvidence(
      quotes,
      materialId,
      full,
      baseLen,
      stances,
      interview ? markerFor(materialId, markersByMaterial) : undefined,
      interview,
    );
    noteAbort(materialId, result.interviewerFilterAborted);
    return result.evidence;
  };

  /** Regroupe les quotes planifiées par matériau pour appliquer le seuil 80 %. */
  function plannedEvidenceGrouped(
    list: { id?: string; quote?: string; stance?: string }[],
  ): Evidence[] {
    const byMaterial = new Map<
      string,
      { quotes: string[]; stances: Map<string, string> }
    >();
    for (const ev of list) {
      if (!ev?.id || !ev?.quote) continue;
      const bucket = byMaterial.get(ev.id) || {
        quotes: [] as string[],
        stances: new Map<string, string>(),
      };
      bucket.quotes.push(ev.quote);
      if (ev.stance) bucket.stances.set(ev.quote, ev.stance);
      byMaterial.set(ev.id, bucket);
    }
    const out: Evidence[] = [];
    for (const [materialId, bucket] of byMaterial) {
      const full = textByMaterial.get(materialId) || "";
      const baseLen = baseLenByMaterial.get(materialId) ?? full.length;
      const stances = stanceMapFromCards(input.cards, materialId);
      for (const [q, st] of bucket.stances) stances.set(q, st);
      out.push(
        ...toEvidence(bucket.quotes, materialId, full, baseLen, stances),
      );
    }
    return out;
  }

  const sections: PipelineSection[] = input.plan.sections.map((s) => {
    const subsections = (s.subsections || []).map((sub) => {
      const planned = plannedEvidenceGrouped(sub.evidence || []);
      return enrichCounts({
        title: sub.title.slice(0, 220),
        advice: (sub.advice || "").slice(0, 4000),
        evidence: planned,
        ...(sub.thesis ? { thesis: sub.thesis.slice(0, 800) } : {}),
        ...(sub.themeIds ? { themeIds: sub.themeIds } : {}),
        ...(sub.hypothesisIndexes
          ? { hypothesisIndexes: sub.hypothesisIndexes }
          : {}),
      });
    });
    const plannedSectionEv = plannedEvidenceGrouped(s.evidence || []);
    return enrichCounts({
      title: s.title.slice(0, 220),
      advice: s.advice.slice(0, 4000),
      evidence: plannedSectionEv,
      ...(s.role ? { role: s.role } : {}),
      ...(s.thesis ? { thesis: s.thesis.slice(0, 800) } : {}),
      ...(s.themeIds ? { themeIds: s.themeIds } : {}),
      ...(s.hypothesisIndexes
        ? { hypothesisIndexes: s.hypothesisIndexes }
        : {}),
      ...(subsections.length ? { subsections } : {}),
    });
  });

  for (const a of input.assignments) {
    if (a.sectionIndex === undefined || a.unused) continue;
    const full = textByMaterial.get(a.materialId) || "";
    const baseLen = baseLenByMaterial.get(a.materialId) ?? full.length;
    const stances = stanceMapFromCards(input.cards, a.materialId);
    const evidence = toEvidence(
      a.quotes,
      a.materialId,
      full,
      baseLen,
      stances,
    );
    const section = sections[a.sectionIndex];
    if (!evidence.length || !section) continue;
    if (
      a.subsectionIndex !== undefined &&
      section.subsections?.[a.subsectionIndex]
    ) {
      section.subsections[a.subsectionIndex].evidence.push(...evidence);
      enrichCounts(section.subsections[a.subsectionIndex]);
    } else {
      section.evidence.push(...evidence);
      enrichCounts(section);
    }
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const hasAny =
      section.evidence.length > 0 ||
      (section.subsections || []).some((s) => s.evidence.length > 0);
    if (hasAny) continue;
    const fallback = input.assignments.find(
      (a) => a.sectionIndex === i && !a.unused,
    );
    if (fallback) {
      const card = input.cards.find((c) => c.unitId === fallback.unitId);
      const full = textByMaterial.get(fallback.materialId) || "";
      const baseLen =
        baseLenByMaterial.get(fallback.materialId) ?? full.length;
      const stances = stanceMapFromCards(input.cards, fallback.materialId);
      const quotes = (card?.claims || [])
        .map((c) => c.quote)
        .filter((q) => q && full.includes(q))
        .slice(0, 2);
      const ev = toEvidence(
        quotes,
        fallback.materialId,
        full,
        baseLen,
        stances,
      );
      if (
        fallback.subsectionIndex !== undefined &&
        section.subsections?.[fallback.subsectionIndex]
      ) {
        section.subsections[fallback.subsectionIndex].evidence = ev;
        enrichCounts(section.subsections[fallback.subsectionIndex]);
      } else {
        section.evidence = ev;
        enrichCounts(section);
      }
    }
  }

  for (const section of sections) {
    const hasAny =
      section.evidence.length > 0 ||
      (section.subsections || []).some((s) => s.evidence.length > 0);
    if (hasAny) continue;
    for (const card of input.cards) {
      if (card.relevance < 1) continue;
      const full = textByMaterial.get(card.materialId) || "";
      const baseLen = baseLenByMaterial.get(card.materialId) ?? full.length;
      const stances = stanceMapFromCards(input.cards, card.materialId);
      for (const claim of card.claims) {
        if (claim.quote && full.includes(claim.quote)) {
          section.evidence = toEvidence(
            [claim.quote],
            card.materialId,
            full,
            baseLen,
            stances,
          );
          enrichCounts(section);
          break;
        }
      }
      if (section.evidence.length) break;
    }
  }

  for (const section of sections) {
    const all = [
      ...section.evidence,
      ...(section.subsections || []).flatMap((s) => s.evidence),
    ];
    section.supportCount = all.length;
    section.materialCount = countMaterials(all);
  }

  const gaps: string[] = [];
  for (const materialId of abortedMaterials) {
    const title = materialTitles.get(materialId) || materialId.slice(0, 8);
    gaps.push(
      `Vérifiez le marqueur de l’enquêteur pour ce matériau (« ${title} ») : trop de passages ressemblaient à des tours de l’enquêteur, aucun n’a été écarté automatiquement.`,
    );
  }

  for (const section of sections) {
    const hasSectionEv = section.evidence.length > 0;
    const subs = section.subsections || [];
    if (subs.length) {
      for (const sub of subs) {
        if (!sub.evidence.length)
          gaps.push(
            `La sous-partie « ${sub.title} » (section « ${section.title} ») n’a aucune citation vérifiable dans le corpus.`,
          );
      }
    } else if (!hasSectionEv) {
      gaps.push(
        `La section « ${section.title} » n’a aucune citation vérifiable dans le corpus.`,
      );
    }
  }

  const hypotheses = input.hypotheses || [];
  for (let i = 0; i < hypotheses.length; i++) {
    const label = hypotheses[i];
    const hasClaimSupport = input.cards.some(
      (c) =>
        c.relevance >= 1 &&
        (c.claims || []).some(
          (cl) =>
            cl.hypothesisIndex === i &&
            cl.stance &&
            cl.stance !== "sans_lien",
        ),
    );
    if (!hasClaimSupport) {
      gaps.push(
        `Hypothèse sans appui dans les matériaux : « ${label.slice(0, 200)} ».`,
      );
    }
  }

  for (const u of input.unused) {
    if (u.unusedReason)
      gaps.push(
        `Unité non utilisée (${u.unitId.slice(0, 8)}…) : ${u.unusedReason}`,
      );
  }

  const failedUnits = Object.entries(input.coverage.units).filter(
    ([, e]) => e.status === "failed",
  );
  for (const [unitId, entry] of failedUnits) {
    gaps.push(
      `Unité en échec (${unitId.slice(0, 8)}…, matériau ${entry.materialId}) : ${entry.reason || "échec d’analyse"}.`,
    );
  }

  const skippedVision = Object.entries(input.coverage.units).filter(
    ([, e]) =>
      e.status === "skipped" &&
      /manuelle|vision|image/i.test(e.reason || ""),
  );
  for (const [unitId, entry] of skippedVision) {
    gaps.push(
      `Image non analysée (${unitId.slice(0, 8)}…) : ${entry.reason || "description manuelle requise"}.`,
    );
  }

  const complete =
    input.coverage.totals.total > 0 &&
    input.coverage.totals.pending === 0 &&
    input.coverage.totals.failed === 0;

  if (!complete)
    gaps.push(
      `Couverture incomplète : ${input.coverage.totals.done}/${input.coverage.totals.total} unités analysées avec succès` +
        (input.coverage.totals.failed
          ? ` (${input.coverage.totals.failed} en échec)`
          : "") +
        ".",
    );

  const withEvidence = sections.filter(
    (s) =>
      s.evidence.length > 0 ||
      (s.subsections || []).some((sub) => sub.evidence.length > 0),
  );
  const finalSections = withEvidence.length ? withEvidence : sections;

  const themes: PipelineTheme[] = (input.themeMap?.themes || []).map((t) => ({
    themeId: t.themeId,
    label: t.label,
    description: t.description,
    emergent: t.emergent,
    fragile:
      t.fragile === true ||
      (typeof t.materialCount === "number"
        ? t.materialCount <= 1
        : (t.unitIds || []).length <= 1),
    materialCount:
      t.materialCount ??
      new Set(
        (t.unitIds || [])
          .map((uid) => input.cards.find((c) => c.unitId === uid)?.materialId)
          .filter(Boolean),
      ).size,
  }));

  return {
    sections: finalSections,
    gaps: gaps.slice(0, 40),
    coverage: { ...input.coverage, complete },
    themes,
  };
}
