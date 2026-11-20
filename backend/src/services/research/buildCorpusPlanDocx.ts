import { Document, Packer, Paragraph, Table } from "docx";
import type { WorkPlan } from "../../../../shared/research/workPlan";
import { genreProfileFor } from "../../../../shared/research/genreProfiles";
import {
  DOC_CAUTION,
  DOC_MARGINS,
  docBody,
  docBullet,
  docHeading,
  docHeading2,
  docItalic,
  docQuote,
  docSourceLine,
  docTitle,
  portraitPageSizeAttrs,
  sectionChrome,
  simpleTable,
} from "../docxTheme";
import {
  buildWorkPlanDocument,
  isUsableWorkPlan,
  planningIntroLine,
  planningSubtitle,
} from "./buildWorkPlanDocxParts";

type PlanEvidence = {
  id?: string;
  quote?: string;
  code?: string;
  title?: string;
  source?: string;
  stance?: string;
};

type PlanSubsection = {
  title?: string;
  thesis?: string;
  advice?: string;
  evidence?: PlanEvidence[];
};

type PlanSection = {
  title?: string;
  advice?: string;
  thesis?: string;
  evidence?: PlanEvidence[];
  subsections?: PlanSubsection[];
};

export type PlanDocKind = "plan" | "schedule";

type PlanInput = {
  kind?: PlanDocKind;
  projectTitle?: string;
  documentLabel?: string;
  /** Id de type de support (bornes preuves du profil). */
  documentType?: string;
  simulated?: boolean;
  date?: string;
  model?: string;
  sections?: PlanSection[];
  gaps?: string[];
  themes?: {
    themeId?: string;
    label?: string;
    emergent?: boolean;
    fragile?: boolean;
    materialCount?: number;
  }[];
  schedule?: {
    label?: string;
    totalDays?: number;
    items?: {
      title?: string;
      dayStart?: number;
      dayEnd?: number;
      share?: string;
      advice?: string;
    }[];
  } | null;
  workPlan?: WorkPlan | null;
};

/** Sous-titre Word : titre · type · date (sans heure ni « simulation »). */
function wordSubtitle(plan: PlanInput, typeFallback: string) {
  return planningSubtitle({
    projectTitle: plan.projectTitle,
    typeLabel: plan.documentLabel || typeFallback,
    generatedAt: plan.date,
  });
}

async function packThemed(
  title: string,
  projectTitle: string | undefined,
  children: (Paragraph | Table)[],
) {
  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            size: portraitPageSizeAttrs(),
            margin: DOC_MARGINS.default,
          },
        },
        ...sectionChrome(projectTitle),
        children,
      },
    ],
  });
  const buffer = Buffer.from(await Packer.toBuffer(document));
  const safe = `${title}-${projectTitle || "manuscrit"}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return {
    filename: `${safe || "document-manuscrit"}.docx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  };
}

function legacyScheduleChildren(plan: PlanInput): (Paragraph | Table)[] {
  const items = plan.schedule?.items || [];
  const children: (Paragraph | Table)[] = [
    docTitle("Planning de rédaction"),
  ];
  children.push(docItalic(wordSubtitle(plan, "Planning de rédaction"), 120));
  children.push(
    docBody(
      planningIntroLine(plan.schedule?.label || "la durée déclarée"),
      160,
    ),
  );
  items.forEach((item, i) => {
    children.push(
      docHeading(
        `${i + 1}. ${item.title || "Phase"} · jours ${item.dayStart}–${item.dayEnd}${
          item.share ? ` (${item.share})` : ""
        }`,
      ),
    );
    if (item.advice) children.push(docBody(item.advice, 100));
  });
  return children;
}

export async function buildCorpusPlanDocx(plan: PlanInput): Promise<{
  filename: string;
  mimeType: string;
  buffer: Buffer;
}> {
  const kind: PlanDocKind = plan.kind === "schedule" ? "schedule" : "plan";

  if (kind === "schedule") {
    if (isUsableWorkPlan(plan.workPlan)) {
      return buildWorkPlanDocument({
        plan: plan.workPlan,
        projectTitle: plan.projectTitle,
        documentLabel: plan.documentLabel || "Planning de rédaction",
        title: "Feuille de route du manuscrit",
        generatedAt: plan.date,
        filenameBase: "feuille-de-route",
      });
    }

    const items = plan.schedule?.items || [];
    if (!items.length) {
      throw Object.assign(new Error("Aucun planning à exporter."), {
        status: 400,
      });
    }
    return packThemed(
      "Planning de rédaction",
      plan.projectTitle,
      legacyScheduleChildren(plan),
    );
  }

  const title = "Plan de rédaction";
  const children: (Paragraph | Table)[] = [docTitle(title)];
  children.push(docItalic(wordSubtitle(plan, title), 160));
  children.push(
    docBody(
      "Guide d’écriture ancré dans vos matériaux. À remanier selon votre jugement scientifique. Ce n’est pas le texte final.",
      180,
    ),
  );

  const annexRows: string[][] = [];
  const evidenceCap = Math.max(
    1,
    genreProfileFor(plan.documentType).preuvesParSection.max,
  );

  function appendEvidence(
    evidence: PlanEvidence[],
    sectionLabel: string,
    cap: number,
  ) {
    const list = evidence.filter((ev) => String(ev.quote || "").trim());
    const shown = list.slice(0, cap);
    const omitted = list.length - shown.length;
    for (const ev of shown) {
      const quote = String(ev.quote || "").trim();
      children.push(docQuote(quote));
      if (ev.stance === "contredit" || ev.stance === "nuance") {
        children.push(docItalic("Contre-exemple", 40));
      }
      if (ev.source === "transcription-ia") {
        children.push(
          docItalic(
            "Transcription automatique — à vérifier sur l’original",
            60,
          ),
        );
      }
      const ref = [ev.code, ev.title].filter(Boolean).join(" · ");
      if (ref) children.push(docSourceLine(ref));
    }
    if (omitted > 0) {
      children.push(
        docItalic(
          `+ ${omitted} autre${omitted > 1 ? "s" : ""} extrait${omitted > 1 ? "s" : ""}, voir annexe`,
          80,
        ),
      );
    }
    for (const ev of list) {
      const quote = String(ev.quote || "").trim().replace(/\s+/g, " ");
      const preview =
        quote.length > 120 ? `${quote.slice(0, 117).trimEnd()}…` : quote;
      annexRows.push([
        String(ev.code || "—"),
        String(ev.title || "—"),
        sectionLabel,
        preview,
      ]);
    }
  }

  (plan.sections || []).forEach((section, i) => {
    const sectionTitle = section.title || "Section";
    children.push(docHeading(`${i + 1}. ${sectionTitle}`));
    if (section.thesis) children.push(docItalic(section.thesis, 80));
    const sectionMats = new Set(
      [
        ...(section.evidence || []).map((e) => e.id),
        ...(section.subsections || []).flatMap((sub) =>
          (sub.evidence || []).map((e) => e.id),
        ),
      ].filter(Boolean),
    );
    if (sectionMats.size)
      children.push(
        docItalic(
          `Appuyé par ${sectionMats.size} matériau${sectionMats.size !== 1 ? "x" : ""}`,
          60,
        ),
      );
    if (section.advice) children.push(docBody(section.advice, 100));
    const subs = section.subsections || [];
    if (subs.length) {
      subs.forEach((sub, j) => {
        const subTitle = sub.title || `Sous-partie ${j + 1}`;
        children.push(docHeading2(`${i + 1}.${j + 1}. ${subTitle}`));
        if (sub.thesis) children.push(docItalic(sub.thesis, 60));
        const subMats = new Set(
          (sub.evidence || []).map((e) => e.id).filter(Boolean),
        );
        if (subMats.size)
          children.push(
            docItalic(
              `Appuyé par ${subMats.size} matériau${subMats.size !== 1 ? "x" : ""}`,
              40,
            ),
          );
        if (sub.advice) children.push(docBody(sub.advice, 80));
        appendEvidence(
          sub.evidence || [],
          `${sectionTitle} › ${subTitle}`,
          evidenceCap,
        );
      });
    } else {
      appendEvidence(section.evidence || [], sectionTitle, evidenceCap);
    }
  });

  if (plan.themes?.length) {
    children.push(docHeading("Thèmes repérés"));
    for (const t of plan.themes) {
      const badges = [
        t.emergent ? "Émergent" : "",
        t.fragile ? "Fragile : une seule source" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      children.push(
        docBullet(
          `${t.label || "Thème"}${badges ? ` — ${badges}` : ""}`,
        ),
      );
    }
  }

  if (plan.gaps?.length) {
    children.push(docHeading("Points à vérifier"));
    for (const gap of plan.gaps) children.push(docBullet(gap));
  }

  if (annexRows.length) {
    children.push(docHeading("Index des extraits"));
    children.push(
      docBody(
        "Liste complète des passages retenus dans ce plan (aperçu tronqué à 120 caractères).",
        100,
      ),
    );
    children.push(
      simpleTable(["Code", "Matériau", "Section", "Début de l’extrait"], annexRows, {
        columnPercents: [12, 22, 26, 40],
        fontSize: 18,
      }),
    );
  }

  children.push(docItalic(DOC_CAUTION, 40));
  return packThemed(title, plan.projectTitle, children);
}
