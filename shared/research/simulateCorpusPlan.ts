/**
 * Aperçu de plan de rédaction sans appel IA :
 * structure type + extraits issus des matériaux déposés.
 */

import {
  writingTimeDays,
  writingTimeLabel,
} from "./corpusOrganization";
import { buildWorkPlan, type PhaseRole } from "./workPlan";
import {
  buildWritingSchedule,
  workPlanToWritingSchedule,
} from "./writingSchedule";

export type SimulatedSource = {
  id: string;
  type?: string;
  title?: string;
  code?: string;
  text: string;
};

export type SimulatedEvidence = {
  id: string;
  quote: string;
  start: number;
  end: number;
};

export type SimulatedSubsection = {
  title: string;
  advice: string;
  evidence: SimulatedEvidence[];
};

export type SimulatedSection = {
  title: string;
  advice: string;
  evidence: SimulatedEvidence[];
  role?: PhaseRole;
  subsections?: SimulatedSubsection[];
};

/**
 * Extrait un passage réel du texte source (offsets utilisables pour la surbrillance).
 * `preferOffset` décale le point de départ pour répartir les citations dans un même texte.
 */
function pickQuoteSpan(
  text: string,
  max = 220,
  preferOffset = 0,
): SimulatedEvidence | null {
  const raw = String(text || "");
  const first = raw.search(/\S/);
  if (first < 0) return null;

  let start = first;
  if (preferOffset > 0 && raw.length - first > max) {
    const candidate = Math.min(
      first + preferOffset,
      Math.max(first, raw.length - max - 1),
    );
    const fromCandidate = raw.slice(candidate);
    const sentence = fromCandidate.search(/[.!?\n]\s+\S/);
    if (sentence >= 0 && sentence < 160) {
      start = candidate + sentence + (fromCandidate[sentence] === "\n" ? 1 : 2);
    } else {
      const space = fromCandidate.search(/\s+\S/);
      start =
        space >= 0 && space < 80 ? candidate + space + 1 : candidate;
    }
    while (start < raw.length && /\s/.test(raw[start])) start += 1;
    if (start >= raw.length - 20) start = first;
  }

  if (raw.length - start <= max) {
    const end = raw.length;
    return { id: "", quote: raw.slice(start, end), start, end };
  }
  const window = raw.slice(start, start + max);
  const breakAt = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf(".\n"),
    window.lastIndexOf("; "),
    window.lastIndexOf("\n"),
    window.lastIndexOf(" "),
    Math.floor(max * 0.6),
  );
  const end = start + Math.max(breakAt, Math.floor(max * 0.45));
  return {
    id: "",
    quote: raw.slice(start, end).trimEnd() + "…",
    start,
    end,
  };
}

export function simulateCorpusPlan(input: {
  format?: string;
  brief?: string;
  writingTime?: string;
  documentType?: string;
  documentTypeOther?: string;
  startDate?: string;
  endDate?: string;
  weeklyTime?: string;
  sources?: SimulatedSource[];
  writingStructure?: {
    title: string;
    intent: string;
    role?: PhaseRole;
    subsections?: { title: string; intent: string }[];
  }[];
  revisionFeedback?: string;
  previousPlan?: { title: string; advice: string }[];
}) {
  const sources = (input.sources || []).filter((s) =>
    String(s.text || "").trim(),
  );
  const structure =
    input.writingStructure && input.writingStructure.length
      ? input.writingStructure
      : [
          {
            title: "Introduction et cadrage",
            intent: "Situer le sujet et le lecteur avant l’analyse.",
            role: "intro" as const,
          },
          {
            title: "Méthode et matériaux",
            intent: "Présenter comment les données seront mobilisées.",
            role: "method" as const,
          },
          {
            title: "Analyses progressives",
            intent: "Croiser les matériaux du simple au complexe.",
            role: "analysis" as const,
          },
          {
            title: "Discussion et conclusion",
            intent: "Synthétiser sans inventer au-delà du corpus.",
            role: "discussion" as const,
          },
        ];

  const format = (input.format || "manuscrit").trim();
  const briefHint = (input.brief || "").trim().slice(0, 120);
  const revision = String(input.revisionFeedback || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
  const previousTitles = (input.previousPlan || [])
    .map((s) => s.title)
    .filter(Boolean);

  /** Compteur d’occurrences par matériau pour décaler les fenêtres d’extrait. */
  const sourceUseCount = new Map<string, number>();

  const sections: SimulatedSection[] = structure.map((step, i) => {
    const source = sources.length ? sources[i % sources.length] : null;
    let span: ReturnType<typeof pickQuoteSpan> = null;
    if (source) {
      const used = sourceUseCount.get(source.id) || 0;
      sourceUseCount.set(source.id, used + 1);
      const preferOffset = used * 260 + i * 48;
      span = pickQuoteSpan(source.text, 220, preferOffset);
    }
    const ref = source
      ? source.code || source.title || "matériau déposé"
      : "vos matériaux";
    const prev = previousTitles[i]
      ? `Par rapport à la version précédente (« ${previousTitles[i]} »), recentrez le fil.`
      : "";
    const briefLine =
      i === 0
        ? briefHint
          ? `Reliez cette section à votre présentation du sujet (« ${briefHint}${
              (input.brief || "").trim().length > 120 ? "…" : ""
            } »).`
          : "Appuyez-vous sur la présentation du sujet déclarée dans le cadrage."
        : "";
    const subsections: SimulatedSubsection[] | undefined = step.subsections
      ?.length
      ? step.subsections.map((sub, j) => {
          const subSource = sources.length
            ? sources[(i + j + 1) % sources.length]
            : null;
          let subSpan: ReturnType<typeof pickQuoteSpan> = null;
          if (subSource) {
            const used = sourceUseCount.get(subSource.id) || 0;
            sourceUseCount.set(subSource.id, used + 1);
            subSpan = pickQuoteSpan(
              subSource.text,
              220,
              used * 260 + (i + 1) * 48 + j * 30,
            );
          }
          const subRef = subSource
            ? subSource.code || subSource.title || "matériau déposé"
            : ref;
          return {
            title: sub.title,
            advice: [
              sub.intent,
              `Mobilisez notamment ${subRef} pour illustrer cette sous-partie.`,
            ]
              .filter(Boolean)
              .join(" "),
            evidence:
              subSource && subSpan
                ? [
                    {
                      id: subSource.id,
                      quote: subSpan.quote,
                      start: subSpan.start,
                      end: subSpan.end,
                    },
                  ]
                : ([] as SimulatedEvidence[]),
          };
        })
      : undefined;
    return {
      title: step.title,
      ...(step.role ? { role: step.role } : {}),
      advice: [
        revision ? "Version révisée (aperçu simulé)." : `Aperçu pour un ${format}.`,
        step.intent,
        revision
          ? `Tenez compte de votre consigne de révision : « ${revision.slice(0, 180)}${
              revision.length > 180 ? "…" : ""
            } ».`
          : "",
        prev,
        briefLine,
        subsections?.length
          ? "Développez via les sous-parties ci-dessous."
          : `Mobilisez notamment ${ref} pour illustrer le propos ; laissez à l’auteur le choix des passages définitifs.`,
      ]
        .filter(Boolean)
        .join(" "),
      evidence:
        subsections?.length
          ? ([] as SimulatedEvidence[])
          : source && span
            ? [
                {
                  id: source.id,
                  quote: span.quote,
                  start: span.start,
                  end: span.end,
                },
              ]
            : ([] as SimulatedEvidence[]),
      ...(subsections?.length ? { subsections } : {}),
    };
  });

  const workPlan = buildWorkPlan({
    writingTime: input.writingTime,
    totalDays: writingTimeDays(input.writingTime) || undefined,
    durationLabel: writingTimeLabel(input.writingTime) || undefined,
    documentType: input.documentType,
    documentTypeOther: input.documentTypeOther,
    weeklyTime: input.weeklyTime,
    startDate: input.startDate,
    endDate: input.endDate,
    sections,
  });

  const schedule = workPlan
    ? workPlanToWritingSchedule(workPlan, writingTimeLabel(input.writingTime))
    : buildWritingSchedule({
        writingTime: input.writingTime,
        writingTimeDays: writingTimeDays(input.writingTime),
        writingTimeLabel: writingTimeLabel(input.writingTime),
        sections,
        documentType: input.documentType,
        documentTypeOther: input.documentTypeOther,
        weeklyTime: input.weeklyTime,
        startDate: input.startDate,
        endDate: input.endDate,
      });

  const totalUnits = sources.length;
  const coverage = {
    totalUnits,
    done: totalUnits,
    failed: 0,
    skipped: 0,
    perMaterial: sources.map((s) => ({
      materialId: s.id,
      total: 1,
      done: 1,
      failed: 0,
      skipped: 0,
      pending: 0,
    })),
    complete: totalUnits > 0,
  };

  return {
    comparisons: [] as unknown[],
    sections,
    schedule,
    workPlan: workPlan || undefined,
    gaps: [
      "Ceci est un aperçu simulé : ce n’est pas encore un plan produit par le service IA.",
      revision
        ? `Consigne de révision prise en compte (simulation) : « ${revision} ».`
        : "",
      sources.length
        ? "Vérifiez chaque extrait cité et complétez les matériaux encore peu documentés."
        : "Ajoutez des matériaux avec du texte exploitable pour ancrer l’aperçu dans votre corpus.",
      schedule
        ? `Planning calé sur ${schedule.label} : ajustez les jalons selon votre rythme réel.`
        : "Indiquez un temps de rédaction dans le cadrage pour obtenir un planning.",
    ].filter(Boolean),
    references: [] as unknown[],
    model: "simulation",
    simulated: true as const,
    revisionFeedback: revision || undefined,
    coverage,
    units: sources.map((s, i) => ({
      id: `sim-unit-${i}-${s.id.slice(0, 8)}`,
      materialId: s.id,
      kind: "text" as const,
      start: 0,
      end: Math.min(220, s.text.length),
      label: `Simulation · ${s.title || s.id}`,
      text: s.text.slice(0, 220),
    })),
  };
}
