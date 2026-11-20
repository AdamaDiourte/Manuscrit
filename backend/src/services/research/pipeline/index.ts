/**
 * Pipeline multi-étapes : unités → extraction → synthèse → planification
 * → affectation → vérification.
 */

import {
  documentTypeLabel,
  writingStructureFor,
  writingTimeLabel,
} from "../../../../../shared/research/corpusOrganization";
import { isInterviewMaterial } from "../../../../../shared/research/interviewMarkers";
import { materialCode, materialText } from "../../../../../shared/research/project";
import {
  buildProjectContext,
  formatProjectContext,
  materialCollectionModeLabel,
  pseudonymizeProjectContext,
  relevanceContextHash,
} from "../../../../../shared/research/projectContext";
import { buildUnits, type ResearchUnit } from "../../../../../shared/research/units";
import { simulateCorpusPlan } from "../../../../../shared/research/simulateCorpusPlan";
import {
  buildWorkPlan,
  findSubmissionEndDate,
} from "../../../../../shared/research/workPlan";
import {
  buildWritingSchedule,
  workPlanToWritingSchedule,
} from "../../../../../shared/research/writingSchedule";
import type { ObjectStore } from "../../../storage/types";
import {
  fetchBatchResults,
  isClaudeProvider,
  pollBatch,
  providerCapabilities,
} from "../../llm/claude";
import { ENGINE_VERSION } from "../engine";
import {
  buildCoverageFromUnits,
  loadMaterialUnits,
  recountCoverage,
  saveMaterialUnits,
  updateJob,
  type CoverageRegistry,
  type ResearchJob,
} from "../jobs";
import { assignCardsToSections } from "./assign";
import {
  extractRealtime,
  ingestBatchExtractResults,
  submitExtractBatch,
} from "./extract";
import {
  hydrateMaterialsVision,
  persistVisionTranscriptions,
} from "./persistVision";
import { hydrateMaterialsTexts } from "../persistMaterialTexts";
import {
  applyPseudonymToText,
  deletePseudonymMap,
  loadPseudonymMap,
  restoreEvidenceQuote,
  savePseudonymMap,
} from "./pseudonym";
import { planSections } from "./plan";
import { synthesizeThemeMap } from "./synthesize";
import {
  addUsage,
  emptyUsage,
  type PipelineUsage,
  type UnitCard,
} from "./types";
import { buildVerifiedPlan } from "./verify";

export type PipelineContext = {
  bucket: ObjectStore;
  ownerPrefix: string;
  jobId: string;
};

export type PipelineOutcome = "done" | "waiting";

function cardsKey(ownerPrefix: string, jobId: string): string {
  return ownerPrefix + "jobs/" + jobId + "/cards";
}

async function saveCards(
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
  cards: UnitCard[],
): Promise<void> {
  await bucket.put(cardsKey(ownerPrefix, jobId), JSON.stringify({ cards }));
}

async function loadCards(
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
): Promise<UnitCard[]> {
  const object = await bucket.get(cardsKey(ownerPrefix, jobId));
  if (!object) return [];
  try {
    const data = await object.json<{ cards?: UnitCard[] }>();
    return Array.isArray(data.cards) ? data.cards : [];
  } catch {
    return [];
  }
}

async function unitsForExtract(
  ctx: PipelineContext,
  job: ResearchJob,
  units: ResearchUnit[],
): Promise<ResearchUnit[]> {
  if (!job.request.pseudonymize) return units;
  let map = await loadPseudonymMap(ctx.bucket, ctx.ownerPrefix, ctx.jobId);
  const names = job.request.pseudonymNames || [];
  const out = units.map((unit) => {
    const { text, map: next } = applyPseudonymToText(unit.text, names, map);
    map = next;
    return { ...unit, text };
  });
  await savePseudonymMap(ctx.bucket, ctx.ownerPrefix, ctx.jobId, map);
  return out;
}

export async function prepareUnitsAndCoverage(
  ctx: PipelineContext,
  materials: unknown[],
): Promise<{ units: ResearchUnit[]; coverage: CoverageRegistry }> {
  const allUnits: ResearchUnit[] = [];
  for (const raw of materials) {
    const material = raw as { id?: string };
    const materialId = String(material?.id || "");
    if (!materialId) continue;
    const existing = await loadMaterialUnits(
      ctx.bucket,
      ctx.ownerPrefix,
      materialId,
    );
    const mode = materialCollectionModeLabel(
      material as { toolType?: string; type?: string },
    );
    const mat = material as {
      type?: string;
      toolType?: string;
      interviewerMarker?: string;
    };
    const interviewerMarker =
      isInterviewMaterial({ ...mat, collectionMode: mode })
        ? String(mat.interviewerMarker || "").trim()
        : "";
    let units =
      existing && existing.length
        ? existing
        : buildUnits(material as Parameters<typeof buildUnits>[0]);
    units = units.map((u) => {
      const next = { ...u };
      if (!next.collectionMode && mode) next.collectionMode = mode;
      if (interviewerMarker) next.interviewerMarker = interviewerMarker;
      else delete next.interviewerMarker;
      return next;
    });
    if (!existing?.length) {
      const meta = material as {
        textFingerprint?: string;
        visionFingerprint?: string;
      };
      await saveMaterialUnits(
        ctx.bucket,
        ctx.ownerPrefix,
        materialId,
        units,
        materialText(material).length,
        {
          textFingerprint: meta.textFingerprint,
          visionFingerprint: meta.visionFingerprint,
        },
      );
    }
    allUnits.push(...units);
  }

  const coverage = buildCoverageFromUnits(allUnits);
  await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (job) => ({
    ...job,
    step: "units",
    progress: { done: 0, total: coverage.totals.total },
    coverage,
  }));
  return { units: allUnits, coverage };
}

function attachSchedule(result: any, project: any, draft: any) {
  const writingTime = draft?.writingTime;
  const opts = {
    writingTime,
    documentType: draft?.documentType,
    documentTypeOther: draft?.documentTypeOther,
    startDate: draft?.startDate || undefined,
    endDate: findSubmissionEndDate(project?.dates),
    weeklyTime: draft?.weeklyTime,
  };
  const sections = result?.sections || [];
  const workPlan =
    result?.workPlan?.phases?.length
      ? result.workPlan
      : buildWorkPlan({
          writingTime: opts.writingTime,
          documentType: opts.documentType,
          documentTypeOther: opts.documentTypeOther,
          startDate: opts.startDate,
          endDate: opts.endDate,
          weeklyTime: opts.weeklyTime,
          sections,
        });
  const schedule = workPlan
    ? workPlanToWritingSchedule(workPlan, writingTimeLabel(opts.writingTime))
    : buildWritingSchedule({
        writingTime: opts.writingTime,
        writingTimeLabel: writingTimeLabel(opts.writingTime),
        sections,
        documentType: opts.documentType,
        documentTypeOther: opts.documentTypeOther,
        startDate: opts.startDate,
        endDate: opts.endDate,
        weeklyTime: opts.weeklyTime,
      });
  return {
    ...result,
    ...(schedule ? { schedule } : {}),
    ...(workPlan ? { workPlan } : {}),
  };
}

async function loadProject(
  bucket: ObjectStore,
  ownerPrefix: string,
  projectId: string,
) {
  const ws = await bucket.get(ownerPrefix + "workspace");
  if (!ws) return null;
  const data = await ws.json<{ projects?: any[] }>();
  return (data.projects || []).find((p) => p.id === projectId) || null;
}

async function finishFromCards(
  ctx: PipelineContext,
  job: ResearchJob,
  materials: unknown[],
  units: ResearchUnit[],
  cards: UnitCard[],
  coverage: CoverageRegistry,
  usage: PipelineUsage,
  project: any,
  draft: any,
  brief: string,
  format: string,
): Promise<void> {
  await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
    ...j,
    step: "synthesize",
    usage,
  }));

  const revision = {
    revisionFeedback: job.request.revisionFeedback || "",
    previousPlan: job.request.previousPlan || [],
  };
  let projectCtx = buildProjectContext(project, draft, revision);
  if (job.request.pseudonymize)
    projectCtx = pseudonymizeProjectContext(
      projectCtx,
      job.request.pseudonymNames || [],
    );
  const briefForReasoning =
    formatProjectContext(projectCtx, { includeRevision: true }) || brief;

  const relevant = cards.filter((c) => c.relevance >= 0);
  const { map, usage: synUsage } = await synthesizeThemeMap(
    relevant,
    briefForReasoning,
    revision,
  );
  usage = addUsage(usage, synUsage);

  await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
    ...j,
    step: "plan",
    usage,
  }));

  const writingStructure =
    job.writingStructure ||
    writingStructureFor(draft?.documentType) ||
    undefined;

  const { plan, usage: planUsage } = await planSections(
    map,
    briefForReasoning,
    format,
    writingStructure as any,
    job.request.revisionFeedback,
    job.request.previousPlan,
    draft?.documentType,
  );
  usage = addUsage(usage, planUsage);

  await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
    ...j,
    step: "assign",
    usage,
  }));

  let { assignments, unused, usage: assignUsage } =
    await assignCardsToSections(cards, plan, briefForReasoning, revision);
  usage = addUsage(usage, assignUsage);

  await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
    ...j,
    step: "verify",
    usage,
  }));

  // Citations affichées = texte original (restauration après pseudonymisation).
  if (job.request.pseudonymize) {
    const pmap = await loadPseudonymMap(
      ctx.bucket,
      ctx.ownerPrefix,
      ctx.jobId,
    );
    if (Object.keys(pmap).length) {
      assignments = assignments.map((a) => ({
        ...a,
        quotes: (a.quotes || []).map((q) => restoreEvidenceQuote(q, pmap)),
      }));
      unused = unused.map((a) => ({
        ...a,
        quotes: (a.quotes || []).map((q) => restoreEvidenceQuote(q, pmap)),
      }));
    }
    // Map plus nécessaire une fois les citations restaurées.
    await deletePseudonymMap(ctx.bucket, ctx.ownerPrefix, ctx.jobId);
  }

  // Fusionner les transcriptions vision dans les matériaux (offsets materialText).
  const enrichedMaterials = materials.map((raw) => {
    const m = { ...(raw as object) } as { id?: string; visionTranscription?: string };
    const parts = cards
      .filter((c) => c.materialId === m.id && c.transcription?.trim())
      .map((c) => c.transcription!.trim());
    if (parts.length)
      m.visionTranscription = [...new Set(parts)].join("\n\n");
    return m;
  });
  await persistVisionTranscriptions(
    ctx.bucket,
    ctx.ownerPrefix,
    job.projectId,
    cards,
  );

  const hypotheses = Array.isArray(projectCtx?.research?.hypotheses)
    ? projectCtx.research.hypotheses
    : [];

  const verified = buildVerifiedPlan({
    plan,
    assignments,
    unused,
    coverage,
    materials: enrichedMaterials,
    units,
    cards,
    hypotheses,
    themeMap: map,
  });

  if (
    !verified.sections.length ||
    !verified.sections.some(
      (s) =>
        s.evidence.length ||
        (s.subsections || []).some((sub) => sub.evidence.length),
    )
  )
    throw new Error(
      "Aucune section avec citation vérifiable n’a pu être produite.",
    );

  const coverageOut = {
    totalUnits: verified.coverage.totals.total,
    done: verified.coverage.totals.done,
    failed: verified.coverage.totals.failed,
    skipped: verified.coverage.totals.skipped,
    perMaterial: verified.coverage.perMaterial,
    complete: verified.coverage.complete,
  };

  let result: any = {
    sections: verified.sections,
    gaps: verified.gaps,
    themes: verified.themes,
    references: [],
    model: "claude-pipeline",
    fingerprint: job.fingerprint || "pipeline-" + job.id.slice(0, 12),
    version: ENGINE_VERSION,
    date: new Date().toISOString(),
    simulated: false,
    coverage: coverageOut,
    unused: unused.map((u) => ({
      unitId: u.unitId,
      materialId: u.materialId,
      reason: u.unusedReason || "Non utilisée",
    })),
    usage,
    jobId: job.id,
  };
  result = attachSchedule(result, project, draft);

  await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
    ...j,
    status: "done",
    step: "done",
    progress: {
      done: verified.coverage.totals.total,
      total: verified.coverage.totals.total,
    },
    coverage: verified.coverage,
    usage,
    result,
    billingToken: undefined,
    batchId: undefined,
    batchPhase: undefined,
    error: undefined,
  }));
}

async function runSimulated(
  ctx: PipelineContext,
  job: ResearchJob,
  materials: unknown[],
  units: ResearchUnit[],
  coverage: CoverageRegistry,
  project: any,
  draft: any,
  brief: string,
  format: string,
): Promise<void> {
  const sources = materials.map((m: any) => ({
    id: m.id,
    type: m.type,
    title: `${materialCode(m)} · ${m.title}`,
    code: materialCode(m),
    text: materialText(m),
  }));

  // Marquer toutes les unités comme done (heuristique simulation).
  const unitsMap = { ...coverage.units };
  for (const unit of units) {
    unitsMap[unit.id] = { status: "done", materialId: unit.materialId };
  }
  const doneCoverage = recountCoverage({ ...coverage, units: unitsMap });

  const simulated = simulateCorpusPlan({
    format,
    brief,
    writingTime: draft?.writingTime,
    documentType: draft?.documentType,
    documentTypeOther: draft?.documentTypeOther,
    startDate: draft?.startDate,
    endDate: findSubmissionEndDate(project?.dates),
    sources,
    writingStructure: writingStructureFor(draft?.documentType),
    revisionFeedback: job.request.revisionFeedback || "",
    previousPlan: job.request.previousPlan || [],
  });

  const coverageOut = {
    totalUnits: doneCoverage.totals.total,
    done: doneCoverage.totals.done,
    failed: 0,
    skipped: 0,
    perMaterial: doneCoverage.perMaterial,
    complete: true,
  };

  let result: any = {
    ...simulated,
    fingerprint: "simulation-pipeline-" + job.id.slice(0, 12),
    version: ENGINE_VERSION,
    date: new Date().toISOString(),
    coverage: coverageOut,
    jobId: job.id,
    simulated: true,
  };
  result = attachSchedule(result, project, draft);

  await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
    ...j,
    status: "done",
    step: "done",
    progress: {
      done: doneCoverage.totals.total,
      total: doneCoverage.totals.total,
    },
    coverage: doneCoverage,
    result,
    billingToken: undefined,
    error: undefined,
  }));
}

/**
 * Exécute ou reprend le pipeline.
 * Retourne "waiting" si un lot Message Batches est en cours.
 */
export async function runResearchPipeline(
  ctx: PipelineContext,
  job: ResearchJob,
  materials: unknown[],
): Promise<PipelineOutcome> {
  const project = await loadProject(
    ctx.bucket,
    ctx.ownerPrefix,
    job.projectId,
  );
  if (!project) throw new Error("Projet introuvable pour la tâche.");
  const draft = project.copilot || {};

  let projectCtx = buildProjectContext(project, draft, {
    revisionFeedback: job.request.revisionFeedback,
    previousPlan: job.request.previousPlan,
  });
  if (job.request.pseudonymize)
    projectCtx = pseudonymizeProjectContext(
      projectCtx,
      job.request.pseudonymNames || [],
    );
  const relevanceHash = relevanceContextHash(projectCtx);
  const brief =
    job.brief ||
    formatProjectContext(projectCtx) ||
    (draft.brief || "").trim();
  const format =
    job.format ||
    documentTypeLabel(draft.documentType, draft.documentTypeOther) ||
    project.type ||
    "";

  const withTexts = await hydrateMaterialsTexts(
    ctx.bucket,
    ctx.ownerPrefix,
    materials as any[],
  );
  const hydrated = await hydrateMaterialsVision(
    ctx.bucket,
    ctx.ownerPrefix,
    withTexts,
  );

  // Reprise après lot d’extraction.
  if (job.status === "waiting_batch" && job.batchId && job.batchPhase === "extract") {
    if (!providerCapabilities().batch)
      throw new Error("Reprise de lot impossible : le fournisseur ne gère pas les batches.");
    const status = await pollBatch(job.batchId);
    if (status.processingStatus !== "ended") return "waiting";

    const { units, coverage } = await prepareUnitsAndCoverage(ctx, hydrated);
    const sendUnits = await unitsForExtract(ctx, job, units);
    const results = await fetchBatchResults(job.batchId);
    const cachedCards = await loadCards(ctx.bucket, ctx.ownerPrefix, ctx.jobId);
    const { cards, usage, coveragePatch } = await ingestBatchExtractResults(
      sendUnits,
      results,
      ctx.bucket,
      ctx.ownerPrefix,
      cachedCards,
      relevanceHash,
    );
    const mergedUnits = { ...coverage.units, ...coveragePatch };
    const recounted = recountCoverage({ ...coverage, units: mergedUnits });
    await saveCards(ctx.bucket, ctx.ownerPrefix, ctx.jobId, cards);
    await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
      ...j,
      status: "running",
      step: "extract",
      batchId: undefined,
      batchPhase: undefined,
      coverage: recounted,
      usage,
      progress: {
        done:
          recounted.totals.done +
          recounted.totals.failed +
          recounted.totals.skipped,
        total: recounted.totals.total,
      },
    }));

    await finishFromCards(
      ctx,
      { ...job, status: "running" },
      hydrated,
      units,
      cards,
      recounted,
      usage,
      project,
      draft,
      brief,
      format,
    );
    return "done";
  }

  const prepared = await prepareUnitsAndCoverage(ctx, hydrated);
  const units = prepared.units;
  let coverage = prepared.coverage;

  if (job.request.simulate) {
    await runSimulated(
      ctx,
      job,
      hydrated,
      units,
      coverage,
      project,
      draft,
      brief,
      format,
    );
    return "done";
  }

  if (!isClaudeProvider())
    throw new Error(
      "Le pipeline d’analyse requiert AI_PROVIDER=anthropic, bedrock ou vertex.",
    );

  await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
    ...j,
    brief,
    format,
    writingStructure: writingStructureFor(draft.documentType),
    step: "extract",
    status: "running",
  }));

  const useBatch =
    job.mode === "batch" && providerCapabilities().batch;

  if (useBatch) {
    const canVision = providerCapabilities().vision;
    const pendingRaw = units.filter(
      (u) => coverage.units[u.id]?.status === "pending",
    );
    const skippedVision: CoverageRegistry["units"] = {};
    const toSend = pendingRaw.filter((u) => {
      if (!canVision && (u.kind === "image" || u.scanned)) {
        skippedVision[u.id] = {
          status: "skipped",
          materialId: u.materialId,
          reason: "description manuelle requise",
        };
        return false;
      }
      return true;
    });
    if (Object.keys(skippedVision).length) {
      coverage = recountCoverage({
        ...coverage,
        units: { ...coverage.units, ...skippedVision },
      });
      await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
        ...j,
        coverage,
      }));
    }
    const pendingUnits = await unitsForExtract(ctx, job, toSend);
    const submitted = await submitExtractBatch(
      pendingUnits,
      brief,
      ctx.bucket,
      ctx.ownerPrefix,
      relevanceHash,
    );
    await saveCards(
      ctx.bucket,
      ctx.ownerPrefix,
      ctx.jobId,
      submitted.cachedCards,
    );

    if (!submitted.batchId) {
      // Tout était en cache.
      const recounted = recountCoverage({
        ...coverage,
        units: {
          ...coverage.units,
          ...Object.fromEntries(
            submitted.cachedCards.map((c) => [
              c.unitId,
              { status: "done" as const, materialId: c.materialId },
            ]),
          ),
        },
      });
      await finishFromCards(
        ctx,
        job,
        hydrated,
        units,
        submitted.cachedCards,
        recounted,
        emptyUsage(),
        project,
        draft,
        brief,
        format,
      );
      return "done";
    }

    await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
      ...j,
      status: "waiting_batch",
      step: "extract",
      batchId: submitted.batchId!,
      batchPhase: "extract",
      progress: {
        done: submitted.cachedCards.length,
        total: units.length,
      },
    }));
    return "waiting";
  }

  // Temps réel
  const pendingOrRetry = units.filter((u) => {
    const st = coverage.units[u.id]?.status;
    return !st || st === "pending" || st === "failed";
  });
  // Ne pas retry failed automatiquement sauf reprise explicite : ici on traite pending.
  const toExtract = units.filter(
    (u) => coverage.units[u.id]?.status === "pending",
  );

  let pseudoMap =
    job.request.pseudonymize
      ? await loadPseudonymMap(ctx.bucket, ctx.ownerPrefix, ctx.jobId)
      : {};
  const names = job.request.pseudonymNames || [];
  const extracted = await extractRealtime(
    toExtract.length ? toExtract : pendingOrRetry,
    brief,
    ctx.bucket,
    ctx.ownerPrefix,
    ctx.jobId,
    coverage,
    async (done, total) => {
      await updateJob(ctx.bucket, ctx.ownerPrefix, ctx.jobId, (j) => ({
        ...j,
        step: "extract",
        progress: { done, total: Math.max(total, j.progress.total) },
      }));
    },
    job.request.pseudonymize
      ? (unit) => {
          const { text, map } = applyPseudonymToText(
            unit.text,
            names,
            pseudoMap,
          );
          pseudoMap = map;
          return { ...unit, text };
        }
      : undefined,
    relevanceHash,
  );
  if (job.request.pseudonymize)
    await savePseudonymMap(
      ctx.bucket,
      ctx.ownerPrefix,
      ctx.jobId,
      pseudoMap,
    );

  // Réintégrer les cartes déjà done (reprise) depuis le cache via extractRealtime partiel :
  // si toExtract était un sous-ensemble, recharger toutes les cartes done.
  let cards = extracted.cards;
  if (cards.length < extracted.coverage.totals.done) {
    const previous = await loadCards(ctx.bucket, ctx.ownerPrefix, ctx.jobId);
    const byId = new Map(cards.map((c) => [c.unitId, c]));
    for (const c of previous) if (!byId.has(c.unitId)) byId.set(c.unitId, c);
    cards = [...byId.values()];
  }
  await saveCards(ctx.bucket, ctx.ownerPrefix, ctx.jobId, cards);

  await finishFromCards(
    ctx,
    job,
    hydrated,
    units,
    cards,
    extracted.coverage,
    extracted.usage,
    project,
    draft,
    brief,
    format,
  );
  return "done";
}
