import { useEffect, useRef, useState } from "react";
import { materialCode } from "../../../../shared/research/project";
import type { GeneratedTopic } from "../../../../shared/research/topicTypes";
import {
  documentKindLabel,
  normalizeProjectType,
} from "../../../../shared/research/documentStructures";
import {
  disciplineLabel,
  documentTypeLabel,
  expectedLengthLabel,
  writingTimeDays,
  writingTimeLabel,
  type CorpusStep,
} from "../../../../shared/research/corpusOrganization";
import {
  buildWorkPlan,
  findSubmissionEndDate,
} from "../../../../shared/research/workPlan";
import {
  buildWritingSchedule,
  workPlanToWritingSchedule,
} from "../../../../shared/research/writingSchedule";
import CorpusOrganizer from "./CorpusOrganizer";
import WritingPlanView from "./WritingPlanView";
import SourcePassageDialog, {
  type PassagePayload,
} from "./SourcePassageDialog";
import { downloadPlanDocx } from "./downloadPlanDocx";
import TopicGenerator from "../topics/TopicGenerator";
import type { DocFile } from "../topics/TopicResults";
import { useConfirmDialog } from "../topics/ConfirmDialog";
import {
  downloadArchivedDoc,
  emptyArchiveMessage,
  makeArchiveId,
  mergeTopicArchives,
  uploadArchivedDoc,
  type TopicArchiveEntry,
} from "../topics/topicArchive";
import { draftFieldsFromTopic } from "../../../../shared/research/projectContext";

export type ResearchPage =
  | "Accueil"
  | "Construire mon projet"
  | "Organiser mon manuscrit";

type Mode = "design" | "corpus";
type Intent = "gate" | "start" | "resume" | "plan";

const RESUME_KEY = "manuscrit-research-resume";
const OPEN_MATERIAL_KEY = "manuscrit-open-material";
const CORPUS_ENTRY_STEP_KEY = "manuscrit-corpus-entry-step";
const ACTIVE_JOB_KEY = "manuscrit-active-research-job";

const JOB_STEP_LABELS: Record<string, string> = {
  queued: "En file d’attente",
  units: "Découpage en unités",
  extract: "Extraction des fiches",
  synthesize: "Synthèse des thèmes",
  plan: "Planification des sections",
  assign: "Affectation des citations",
  verify: "Vérification des extraits",
  done: "Terminé",
  cancelled: "Annulé",
  waiting_batch: "Lot économique en cours",
};

type JobProgressView = {
  jobId: string;
  status: string;
  step: string;
  progress: { done: number; total: number };
  error?: string;
};

function readCorpusEntryStep(): CorpusStep | null {
  try {
    const step = sessionStorage.getItem(CORPUS_ENTRY_STEP_KEY);
    sessionStorage.removeItem(CORPUS_ENTRY_STEP_KEY);
    if (
      step === "frame" ||
      step === "materials" ||
      step === "plan" ||
      step === "project" ||
      step === "notice"
    ) {
      return step;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function keepCorpusStartFlow() {
  try {
    sessionStorage.setItem(RESUME_KEY, "corpus-start");
  } catch {
    /* ignore */
  }
}

export function keepCorpusProjectsFlow(next: "resume" | "plan" = "resume") {
  try {
    sessionStorage.setItem(
      RESUME_KEY,
      next === "plan" ? "corpus-plan" : "corpus-projects",
    );
  } catch {
    /* ignore */
  }
}

function readResumeIntent(): Intent {
  try {
    const stored = sessionStorage.getItem(RESUME_KEY);
    if (stored === "corpus-start") {
      sessionStorage.removeItem(RESUME_KEY);
      return "start";
    }
    if (stored === "corpus-projects") {
      sessionStorage.removeItem(RESUME_KEY);
      return "resume";
    }
    if (stored === "corpus-plan") {
      sessionStorage.removeItem(RESUME_KEY);
      return "plan";
    }
  } catch {
    /* ignore */
  }
  return "gate";
}

type ProjectSummary = {
  id: string;
  title: string;
  type: string;
  typeOther?: string;
  demo?: boolean;
  materials?: {
    id: string;
    title: string;
    type: string;
    hasText: boolean;
  }[];
  frame?: {
    documentType?: string;
    documentTypeOther?: string;
    discipline?: string;
    disciplineOther?: string;
    expectedLength?: string;
    writingTime?: string;
    startDate?: string;
    brief?: string;
  };
  dates?: { id?: string; title?: string; date?: string }[];
  plan?: {
    date?: string;
    simulated?: boolean;
    model?: string;
    sections?: number;
    data?: any;
  } | null;
};

type Props = {
  page: ResearchPage;
  p: any;
  projects: ProjectSummary[];
  ready: boolean;
  save: (draft: any) => Promise<void>;
  add: () => void;
  open: (m: any) => void;
  createProject: () => void;
  deleteProject: (projectId: string) => Promise<void>;
  selectProject: (id: string) => void;
  go: (page: string) => void;
};

const PROJECT_TITLE_COLORS = [
  "#1e4d63",
  "#8a5a18",
  "#2f6b5c",
  "#5c3d12",
  "#3d5668",
  "#7a3e2e",
];

/** Aperçu cadrage dans Mes projets : au-delà, points de suspension. */
const PROJECT_BRIEF_PREVIEW_CHARS = 160;

function previewBrief(text?: string, max = PROJECT_BRIEF_PREVIEW_CHARS) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const breakAt = Math.max(cut.lastIndexOf(" "), Math.floor(max * 0.7));
  return cut.slice(0, breakAt).trimEnd() + "…";
}

/** Efface le parcours « Démarrer » tout en conservant plan et archive. */
function clearCorpusStartFields(draft: any, full = false) {
  const next = { ...draft };
  next.corpusNoticeAccepted = false;
  next.corpusAiAccepted = false;
  next.corpusPrivacyAccepted = false;
  next.corpusProjectConfirmed = false;
  if (full) {
    next.documentType = "";
    next.documentTypeOther = "";
    next.discipline = "";
    next.disciplineOther = "";
    next.specialty = "";
    next.brief = "";
    next.researchQuestion = "";
    next.workingTitle = "";
    next.hypotheses = "";
    next.method = "";
    next.fieldOrCorpus = "";
    next.expectedLength = "";
    next.writingTime = "";
    next.startDate = "";
    next.excluded = [];
    next.collectionModes = [];
    next.collectionModesOther = "";
    next.collectionCombinedNote = "";
    next.briefName = "";
    next.briefFile = "";
  }
  return next;
}

function draftFromTopic(
  topic: GeneratedTopic,
  answers: Record<string, unknown> = {},
  existing: Record<string, unknown> = {},
) {
  return draftFieldsFromTopic(topic, answers, existing);
}

const modeOf = (page: ResearchPage): Mode | null =>
  page === "Construire mon projet"
    ? "design"
    : page === "Organiser mon manuscrit"
      ? "corpus"
      : null;

function archiveList(draft: any): TopicArchiveEntry[] {
  return Array.isArray(draft.topicArchive) ? draft.topicArchive : [];
}

const AXIS_LABEL: Record<string, string> = {
  mastery: "Maîtrise",
  ambition: "Ambition",
  discovery: "Découverte",
};

export default function ResearchStudio({
  page,
  p,
  projects,
  ready,
  save,
  add,
  open,
  createProject,
  deleteProject,
  selectProject,
  go,
}: Props) {
  const mode = modeOf(page);
  const [intent, setIntent] = useState<Intent>(() =>
    page === "Organiser mon manuscrit" ? readResumeIntent() : "gate",
  );
  const [freshStart, setFreshStart] = useState(false);
  const [archiveTabs, setArchiveTabs] = useState<Record<string, string>>({});
  const [openCorpusProjects, setOpenCorpusProjects] = useState<
    Record<string, boolean>
  >({});
  const entryStepBoot = useRef(readCorpusEntryStep());
  const [corpusEntryStep, setCorpusEntryStep] = useState<CorpusStep | null>(
    () => entryStepBoot.current,
  );
  const [draft, set] = useState<any>(() => {
    const base = p.copilot || {};
    if (entryStepBoot.current && !p.demo) {
      return {
        ...base,
        corpusProjectConfirmed: true,
        corpusNoticeAccepted: true,
        corpusAiAccepted: true,
        corpusPrivacyAccepted: true,
      };
    }
    return base;
  }),
    [consent, agree] = useState(false),
    [external, search] = useState(false),
    [simulatePlan, setSimulatePlan] = useState(true),
    [query, setQuery] = useState(""),
    [busy, wait] = useState(false),
    [msg, notice] = useState(""),
    [reading, read] = useState<PassagePayload | null>(null),
    [preferBatch, setPreferBatch] = useState(false),
    [jobProgress, setJobProgress] = useState<JobProgressView | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  function clearJobPoll() {
    if (jobPollRef.current) {
      clearInterval(jobPollRef.current);
      jobPollRef.current = null;
    }
  }

  function rememberJobId(jobId: string | null) {
    try {
      if (jobId) sessionStorage.setItem(ACTIVE_JOB_KEY, jobId);
      else sessionStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {
      /* ignore */
    }
  }

  async function pollResearchJob(jobId: string): Promise<any> {
    const response = await fetch(
      `/api/research/jobs/${encodeURIComponent(jobId)}`,
    );
    const data = (await response.json()) as any;
    if (!response.ok) throw Error(data.error || "Suivi de tâche impossible.");
    return data;
  }

  async function awaitResearchJob(jobId: string): Promise<any> {
    rememberJobId(jobId);
    setJobProgress({
      jobId,
      status: "queued",
      step: "queued",
      progress: { done: 0, total: 0 },
    });
    return new Promise((resolve, reject) => {
      clearJobPoll();
      const tick = async () => {
        try {
          const data = await pollResearchJob(jobId);
          setJobProgress({
            jobId,
            status: data.status,
            step: data.step || data.status,
            progress: data.progress || { done: 0, total: 0 },
            error: data.error,
          });
          if (data.status === "done" && data.result) {
            clearJobPoll();
            rememberJobId(null);
            setJobProgress(null);
            resolve(data.result);
            return;
          }
          if (data.status === "failed" || data.status === "cancelled") {
            clearJobPoll();
            rememberJobId(null);
            setJobProgress(null);
            reject(
              new Error(
                data.error ||
                  (data.status === "cancelled"
                    ? "Analyse annulée."
                    : "Analyse interrompue."),
              ),
            );
          }
        } catch (e) {
          clearJobPoll();
          rememberJobId(null);
          setJobProgress(null);
          reject(e);
        }
      };
      void tick();
      jobPollRef.current = setInterval(() => void tick(), 3000);
    });
  }

  async function cancelActiveJob() {
    const id = jobProgress?.jobId;
    if (!id) return;
    try {
      await fetch(`/api/research/jobs/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
      });
    } catch {
      /* le poll affichera l’état */
    }
  }

  useEffect(() => {
    return () => clearJobPoll();
  }, []);

  useEffect(() => {
    if (mode !== "corpus" || busy || jobProgress) return;
    let stored = "";
    try {
      stored = sessionStorage.getItem(ACTIVE_JOB_KEY) || "";
    } catch {
      return;
    }
    if (!stored) return;
    wait(true);
    void awaitResearchJob(stored)
      .then(async (result) => {
        const next = { ...draftRef.current, corpusResult: result };
        set(next);
        await save(next);
        notice(
          result.simulated
            ? "Aperçu simulé enregistré. Ce n’est pas encore un plan produit par le service IA."
            : "Plan de rédaction enregistré. Vérifiez chaque section et les extraits cités avant de les retenir.",
        );
        setIntent("plan");
      })
      .catch((e: any) => {
        notice(e?.message || "Reprise de l’analyse impossible.");
      })
      .finally(() => wait(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, p.id]);

  useEffect(() => {
    const incomingArchive = archiveList(p.copilot || {});
    if (!incomingArchive.length) return;
    set((local: any) => {
      const localArchive = archiveList(local);
      const merged = mergeTopicArchives(localArchive, incomingArchive);
      if (JSON.stringify(localArchive) === JSON.stringify(merged)) return local;
      return { ...local, topicArchive: merged };
    });
  }, [p.copilot]);

  useEffect(() => {
    if (mode !== "corpus") return;
    let materialId = "";
    try {
      materialId = sessionStorage.getItem(OPEN_MATERIAL_KEY) || "";
      if (materialId) sessionStorage.removeItem(OPEN_MATERIAL_KEY);
    } catch {
      return;
    }
    if (!materialId) return;
    const m = (p.materials || []).find((x: any) => x.id === materialId);
    if (m) open(m);
  }, [mode, p.id, p.materials, open]);

  function archiveActiveAxis(entry: TopicArchiveEntry): string {
    const stored = archiveTabs[entry.id];
    if (stored && entry.topics.some((t) => t.axis === stored)) return stored;
    if (
      entry.chosenTopic?.axis &&
      entry.topics.some((t) => t.axis === entry.chosenTopic!.axis)
    ) {
      return entry.chosenTopic.axis;
    }
    return entry.topics[0]?.axis || "mastery";
  }

  function setArchiveActiveAxis(entryId: string, axis: string) {
    setArchiveTabs((prev) => ({ ...prev, [entryId]: axis }));
  }

  async function downloadArchiveDocument(
    entry: TopicArchiveEntry,
    doc: NonNullable<TopicArchiveEntry["documents"]>[number],
  ) {
    if (busy) return;
    wait(true);
    notice("");
    try {
      const { fileId, filename } = await downloadArchivedDoc({
        projectId: p.id,
        archiveId: entry.id,
        doc,
      });
      if (fileId !== doc.fileId || filename !== doc.filename) {
        const current = draftRef.current;
        const existing = archiveList(current);
        const nextArchive = existing.map((e) => {
          if (e.id !== entry.id || !e.documents?.length) return e;
          return {
            ...e,
            documents: e.documents.map((d) =>
              d.kind === doc.kind ? { ...d, fileId, filename } : d,
            ),
          };
        });
        await persistDraft({ ...current, topicArchive: nextArchive });
      }
      notice("Document téléchargé (Word).");
    } catch (e: any) {
      notice(e?.message || "Téléchargement Word impossible.");
    } finally {
      wait(false);
    }
  }

  const update = (key: string, value: any) => {
    set((d: any) => ({ ...d, [key]: value }));
    notice("");
  };

  async function runResearchRequest(opts: {
    simulate: boolean;
    revisionFeedback?: string;
    previousPlan?: { title: string; advice: string }[];
  }): Promise<any> {
    const response = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: p.id,
        mode: mode || "corpus",
        consent: true,
        simulate: opts.simulate,
        publicQuery: external ? query : "",
        preferBatch,
        modeEconomique: preferBatch,
        revisionFeedback: opts.revisionFeedback || "",
        previousPlan: opts.previousPlan || [],
      }),
    });
    const payload = (await response.json()) as any;
    if (response.status === 202 && payload.jobId)
      return await awaitResearchJob(payload.jobId);
    if (!response.ok) throw Error(payload.error || "Analyse impossible.");
    return payload;
  }

  async function persist(run: boolean): Promise<boolean> {
    if (busy || !mode) return false;
    wait(true);
    notice("");
    try {
      if (!consent) throw Error("Confirmez les conditions de dépôt.");
      if (mode === "corpus") {
        if (p.demo || !draft.corpusProjectConfirmed)
          throw Error(
            "Créez ou choisissez un projet personnel, puis confirmez l’association.",
          );
        if (
          !(
            draft.corpusNoticeAccepted &&
            draft.corpusAiAccepted &&
            draft.corpusPrivacyAccepted
          )
        )
          throw Error(
            "Acceptez d’abord les conditions d’anonymisation et d’usage de l’IA.",
          );
        if (!(p.materials || []).length)
          throw Error(
            "Ajoutez au moins une fiche (outil + données recueillies) avant de continuer.",
          );
      }
      await save(draft);
      if (!run) {
        notice("Cadrage enregistré dans ce projet.");
        return true;
      }
      if (mode === "corpus") {
        const result = await runResearchRequest({ simulate: simulatePlan });
        const next = { ...draft, corpusResult: result };
        set(next);
        await save(next);
        notice(
          result.simulated
            ? "Aperçu simulé enregistré. Ce n’est pas encore un plan produit par le service IA."
            : "Plan de rédaction enregistré. Vérifiez chaque section et les extraits cités avant de les retenir.",
        );
        return true;
      }
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: p.id,
          mode,
          consent,
          simulate: false,
          publicQuery: external ? query : "",
        }),
      });
      const result = (await response.json()) as any;
      if (!response.ok) throw Error(result.error);
      const next = { ...draft, [mode + "Result"]: result };
      set(next);
      await save(next);
      notice(
        "Proposition enregistrée. Examinez chaque piste avant de la retenir.",
      );
      return true;
    } catch (e: any) {
      notice(e.message || "Enregistrement impossible.");
      return false;
    } finally {
      wait(false);
    }
  }

  const result = mode ? draft[mode + "Result"] : null;
  const topicArchive = archiveList(draft);
  const hasProposals = topicArchive.length > 0;

  useEffect(() => {
    if (mode === "corpus" && intent === "plan" && !result) {
      setIntent("resume");
    }
  }, [mode, intent, result]);

  async function persistDraft(nextDraft: any) {
    set(nextDraft);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await save(nextDraft);
        return;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Enregistrement impossible.");
  }

  async function recordTopicsGenerated(payload: {
    sessionId: string;
    topics: GeneratedTopic[];
    answers: Record<string, unknown>;
    model?: string;
    simulated?: boolean;
  }) {
    const now = new Date().toISOString();
    const current = draftRef.current;
    const existing = archiveList(current);
    const idx = existing.findIndex((e) => e.id === payload.sessionId);
    const previous = idx >= 0 ? existing[idx] : null;
    const entry: TopicArchiveEntry = {
      id: payload.sessionId || makeArchiveId(),
      at: previous?.at || now,
      updatedAt: now,
      model: payload.model,
      simulated: payload.simulated,
      projectType: String(payload.answers.project_type || ""),
      answers: payload.answers,
      topics: payload.topics,
      chosenTopic: previous?.chosenTopic ?? null,
      documents: previous?.documents,
    };
    const nextArchive = mergeTopicArchives(
      existing,
      idx >= 0
        ? existing.map((e, i) => (i === idx ? entry : e))
        : [entry, ...existing],
    );
    await persistDraft({ ...current, topicArchive: nextArchive });
  }

  async function chooseTopic(
    topic: GeneratedTopic,
    docs: DocFile[],
    sessionId: string,
    answers: Record<string, unknown> = {},
  ) {
    const now = new Date().toISOString();
    let documents: TopicArchiveEntry["documents"] = [];
    let uploadError = "";
    try {
      documents = await Promise.all(
        docs.map(async (doc) => ({
          kind: doc.kind,
          filename: doc.filename,
          fileId: await uploadArchivedDoc(doc),
        })),
      );
    } catch (e: any) {
      uploadError = e?.message || "Archivage des fichiers impossible.";
      documents = [];
    }
    const current = draftRef.current;
    const existing = archiveList(current);
    const idx = existing.findIndex((e) => e.id === sessionId);
    const base: TopicArchiveEntry =
      idx >= 0
        ? existing[idx]
        : {
            id: sessionId || makeArchiveId(),
            at: now,
            updatedAt: now,
            topics: [topic],
          };
    const entry: TopicArchiveEntry = {
      ...base,
      updatedAt: now,
      topics: base.topics?.length ? base.topics : [topic],
      chosenTopic: topic,
      documents: documents.length ? documents : base.documents,
    };
    const nextArchive = mergeTopicArchives(
      existing,
      idx >= 0
        ? existing.map((e, i) => (i === idx ? entry : e))
        : [entry, ...existing],
    );
    const fromTopic = draftFromTopic(topic, answers, current);
    const nextDraft = {
      ...current,
      ...fromTopic,
      topicArchive: nextArchive.map((e) =>
        e.id === entry.id
          ? {
              ...e,
              answers: (fromTopic.topicAnswers as Record<string, unknown>) || answers,
            }
          : e,
      ),
    };
    try {
      await persistDraft(nextDraft);
      notice(
        uploadError
          ? "Sujet retenu. " + uploadError
          : "Sujet retenu. Projet et plan archivés.",
      );
    } catch {
      set(nextDraft);
      notice(
        "Sujet retenu localement. Réessayez d’enregistrer pour conserver l’archive.",
      );
    }
  }

  async function deleteArchiveEntry(entryId: string) {
    if (busy) return;
    const confirmed = await confirm({
      title: "Supprimer la sollicitation",
      message:
        "Cette action retire les trois sujets proposés et les fichiers générés associés de l’archive.",
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
      danger: true,
    });
    if (!confirmed) return;
    wait(true);
    notice("");
    try {
      let nextDraft: any = null;
      set((d: any) => {
        const existing = archiveList(d);
        const removed = existing.find((e) => e.id === entryId);
        const nextArchive = existing.filter((e) => e.id !== entryId);
        nextDraft = {
          ...d,
          topicArchive: nextArchive,
        };
        if (
          removed?.chosenTopic &&
          d.chosenTopic?.axis === removed.chosenTopic.axis &&
          d.chosenTopic?.title === removed.chosenTopic.title
        ) {
          delete nextDraft.chosenTopic;
        }
        return nextDraft;
      });
      if (nextDraft) await persistDraft(nextDraft);
      notice("Sollicitation supprimée de l’archive.");
    } catch (e: any) {
      notice(e.message || "Suppression impossible.");
    } finally {
      wait(false);
    }
  }

  async function resetCorpusStart(full: boolean) {
    const next = clearCorpusStartFields(draft, full);
    set(next);
    agree(false);
    search(false);
    setSimulatePlan(true);
    setQuery("");
    await persistDraft(next);
  }

  async function abandonCorpusStart() {
    if (busy) return;
    const confirmed = await confirm({
      title: "Abandonner ce démarrage",
      message:
        "Le formulaire en cours sera réinitialisé (consentement et cadrage). Les matériaux et le plan déjà enregistrés sur le projet sont conservés.",
      confirmLabel: "Abandonner",
      cancelLabel: "Continuer",
      danger: true,
    });
    if (!confirmed) return;
    wait(true);
    notice("");
    try {
      await resetCorpusStart(true);
      notice("Démarrage abandonné. Formulaire réinitialisé.");
      setIntent("gate");
    } catch (e: any) {
      notice(e.message || "Réinitialisation impossible.");
    } finally {
      wait(false);
    }
  }

  function projectPlanPayload(project: ProjectSummary) {
    const planData =
      project.plan?.data ||
      (project.id === p.id ? draft.corpusResult || result : null);
    const writingTime =
      project.frame?.writingTime ||
      (project.id === p.id ? draft.writingTime : undefined);
    const documentType =
      project.frame?.documentType ||
      (project.id === p.id ? draft.documentType : undefined);
    const documentTypeOther =
      project.frame?.documentTypeOther ||
      (project.id === p.id ? draft.documentTypeOther : undefined);
    const startDate =
      project.frame?.startDate ||
      (project.id === p.id ? draft.startDate : undefined) ||
      undefined;
    const endDate = findSubmissionEndDate(
      project.id === p.id ? p.dates : project.dates,
    );
    const workPlan =
      planData?.workPlan?.phases?.length
        ? planData.workPlan
        : planData?.sections?.length
          ? buildWorkPlan({
              writingTime,
              totalDays: writingTimeDays(writingTime) || undefined,
              durationLabel: writingTimeLabel(writingTime) || undefined,
              documentType,
              documentTypeOther,
              startDate,
              endDate,
              sections: planData.sections,
            })
          : null;
    const schedule =
      planData?.schedule?.items?.length
        ? planData.schedule
        : workPlan
          ? workPlanToWritingSchedule(workPlan, writingTimeLabel(writingTime))
          : planData?.sections?.length
            ? buildWritingSchedule({
                writingTime,
                writingTimeDays: writingTimeDays(writingTime),
                writingTimeLabel: writingTimeLabel(writingTime),
                sections: planData.sections,
                documentType,
                documentTypeOther,
                startDate,
                endDate,
              })
            : null;
    const materials =
      project.id === p.id
        ? (p.materials || []).map((m: any) => ({
            id: m.id,
            title: m.title,
            type: m.type,
          }))
        : (project.materials || []).map((m) => ({
            id: m.id,
            title: m.title,
            type: m.type,
          }));
    return {
      planData: planData
        ? { ...planData, ...(workPlan ? { workPlan } : {}) }
        : planData,
      schedule,
      workPlan,
      materials,
      documentLabel: documentTypeLabel(documentType, documentTypeOther),
    };
  }

  async function downloadProjectDoc(
    project: ProjectSummary,
    kind: "plan" | "schedule",
  ) {
    const { planData, schedule, workPlan, materials, documentLabel } =
      projectPlanPayload(project);
    if (kind === "plan" && !planData?.sections?.length) {
      notice("Aucun plan téléchargeable pour ce projet.");
      return;
    }
    if (kind === "schedule" && !schedule?.items?.length) {
      notice(
        "Aucun planning téléchargeable. Indiquez un temps de rédaction dans le cadrage, puis relancez le plan.",
      );
      return;
    }
    wait(true);
    notice("");
    try {
      await downloadPlanDocx({
        kind,
        projectTitle: project.title,
        documentLabel,
        plan: {
          ...planData,
          schedule: kind === "schedule" ? schedule : undefined,
          workPlan: kind === "schedule" ? workPlan : undefined,
          sections: kind === "plan" ? planData.sections : undefined,
          gaps: kind === "plan" ? planData.gaps : undefined,
        },
        materials,
      });
      notice(
        kind === "schedule"
          ? "Planning téléchargé (Word)."
          : "Plan de rédaction téléchargé (Word).",
      );
    } catch (e: any) {
      notice(e.message || "Téléchargement Word impossible.");
    } finally {
      wait(false);
    }
  }

  async function removeCorpusProject(projectId: string, title: string) {
    if (busy) return;
    const confirmed = await confirm({
      title: "Supprimer le projet",
      message: `Supprimer « ${title} » et tout son contenu (matériaux, cadrage, plan) ? Cette action est définitive.`,
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
      danger: true,
    });
    if (!confirmed) return;
    wait(true);
    notice("");
    try {
      keepCorpusProjectsFlow("resume");
      await deleteProject(projectId);
      notice("Projet supprimé.");
      setIntent("resume");
    } catch (e: any) {
      notice(e.message || "Suppression impossible.");
    } finally {
      wait(false);
    }
  }

  function corpusProjectOpen(projectId: string, index: number) {
    if (Object.prototype.hasOwnProperty.call(openCorpusProjects, projectId)) {
      return openCorpusProjects[projectId];
    }
    return index === 0 || projectId === p.id;
  }

  function toggleCorpusProject(projectId: string, index: number) {
    setOpenCorpusProjects((prev) => {
      const currently = Object.prototype.hasOwnProperty.call(prev, projectId)
        ? prev[projectId]
        : index === 0 || projectId === p.id;
      return { ...prev, [projectId]: !currently };
    });
  }

  /** Ouvre le parcours à une étape précise (cadrage / matériaux / demande de plan). */
  async function openCorpusEditor(
    step: "frame" | "materials" | "plan",
    projectId = p.id,
  ) {
    if (busy) return;
    const target = projects.find((x) => x.id === projectId) || {
      id: projectId,
      demo: p.demo,
      title: p.title,
    };
    if (target.demo) {
      notice(
        "Choisissez ou créez un projet personnel avant de continuer.",
      );
      return;
    }
    wait(true);
    notice("");
    try {
      if (projectId === p.id) {
        const next = {
          ...draft,
          corpusProjectConfirmed: true,
          corpusNoticeAccepted: true,
          corpusAiAccepted: true,
          corpusPrivacyAccepted: true,
        };
        set(next);
        await persistDraft(next);
        setCorpusEntryStep(step);
        setIntent("start");
      } else {
        try {
          sessionStorage.setItem(CORPUS_ENTRY_STEP_KEY, step);
        } catch {
          /* ignore */
        }
        keepCorpusStartFlow();
        selectProject(projectId);
      }
    } catch (e: any) {
      notice(e.message || "Ouverture impossible.");
    } finally {
      wait(false);
    }
  }

  if (page === "Accueil")
    return (
      <div className="cp-home">
        <div className="cp-heading">
          <h2>Accueil</h2>
          <p>
            Choisissez votre parcours, puis démarrez un travail neuf ou
            reprenez ce qui est déjà engagé.
          </p>
        </div>
        <div className="cp-choices cp-choices-2">
          <button
            className="cp-choice design"
            onClick={() => go("Construire mon projet")}
          >
            <span className="cp-icon" aria-hidden="true">
              <i className="fa-solid fa-pen-to-square" />
            </span>
            <h3>Construire mon projet</h3>
            <p>
              Choisir un sujet, cadrer la question de recherche, le terrain et
              la méthode.
            </p>
            <b>
              Ouvrir ce parcours <i className="fa-solid fa-arrow-right" />
            </b>
          </button>
          <button
            className="cp-choice corpus"
            onClick={() => go("Organiser mon manuscrit")}
          >
            <span className="cp-icon" aria-hidden="true">
              <i className="fa-solid fa-folder-open" />
            </span>
            <h3>Organiser mon manuscrit</h3>
            <p>
              Associez un projet, déposez vos matériaux en indiquant le mode de
              recueil sur chaque fiche, puis obtenez un plan de rédaction ancré
              dans vos données.
            </p>
            <b>
              Ouvrir ce parcours <i className="fa-solid fa-arrow-right" />
            </b>
          </button>
        </div>
        <div className="cp-note">
          <i className="fa-solid fa-circle-info" aria-hidden="true" />
          <span>
            Vous restez l’auteur de la recherche. Chaque proposition est une
            base à discuter, à reconstruire et à justifier. Changez de projet
            via « Mes projets ».
          </span>
        </div>
      </div>
    );

  if (mode && intent === "gate") {
    const corpusProjects = projects.filter((x) => !x.demo);
    const withWork = corpusProjects.filter(
      (x) =>
        (x.materials && x.materials.length > 0) ||
        x.plan ||
        x.frame?.documentType ||
        x.frame?.brief,
    );
    return (
      <section className="cp-flow topic-flow">
        <div className="topic-flow-bar">
          <button
            type="button"
            className="secondary topic-back"
            onClick={() => go("Accueil")}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Accueil
          </button>
        </div>
        <div className="cp-heading">
          <h2>
            {mode === "design"
              ? "Construire mon projet"
              : "Organiser mon manuscrit"}
          </h2>
          <p>
            {mode === "design"
              ? "Démarrez un nouveau parcours, ou consultez l’archive des propositions déjà générées."
              : "Associez un projet, déposez chaque fiche avec son outil et ses données recueillies, puis demandez un plan de rédaction fondé sur vos données."}
          </p>
          <small className="cp-project-hint">
            {p.demo ? "Parcours d’exemple" : `${p.title} · ${p.type}`}
          </small>
        </div>
        <div className="cp-choices cp-choices-2 cp-gate-choices">
          <button
            className="cp-choice gate-start"
            onClick={() => {
              setFreshStart(true);
              setIntent("start");
            }}
          >
            <span className="cp-gate-kicker">Nouveau</span>
            <span className="cp-icon" aria-hidden="true">
              <i className="fa-solid fa-plus" />
            </span>
            <h3>Démarrer</h3>
            <p>
              {mode === "design"
                ? "Choisir un sujet parmi trois propositions, puis générer le projet et le plan."
                : "Projet, consentement, matériaux (outil + données + code), cadrage du support, puis plan de rédaction."}
            </p>
            <b>
              Commencer <i className="fa-solid fa-arrow-right" />
            </b>
          </button>
          <button
            className="cp-choice gate-archive"
            onClick={() => setIntent("resume")}
          >
            <span className="cp-gate-kicker">
              {mode === "design" ? "Archive" : "Projets"}
            </span>
            <span className="cp-icon" aria-hidden="true">
              <i
                className={
                  mode === "design"
                    ? "fa-solid fa-book-open"
                    : "fa-solid fa-folder-tree"
                }
              />
            </span>
            <h3>
              {mode === "design" ? "Propositions faites" : "Mes projets"}
            </h3>
            <p>
              {mode === "design"
                ? hasProposals
                  ? `${topicArchive.length} sollicitation${topicArchive.length > 1 ? "s" : ""} : sujets proposés, choix, projet et plan.`
                  : emptyArchiveMessage()
                : withWork.length
                  ? `${withWork.length} projet${withWork.length > 1 ? "s" : ""} avec matériaux et/ou plan, regroupés pour les distinguer.`
                  : corpusProjects.length
                    ? "Vos projets sont listés ici : matériaux et plans apparaîtront dès qu’ils seront déposés."
                    : "Créez un projet personnel pour y rattacher matériaux et plans."}
            </p>
            <b>
              {mode === "design"
                ? hasProposals
                  ? "Ouvrir l’archive"
                  : "Voir l’état"
                : "Voir mes projets"}{" "}
              <i className="fa-solid fa-arrow-right" />
            </b>
          </button>
        </div>
      </section>
    );
  }

  if (mode === "design" && intent === "resume") {
    return (
      <section className="cp-flow topic-flow">
        {confirmDialog}
        <div className="topic-flow-bar">
          <button
            type="button"
            className="secondary topic-back"
            onClick={() => setIntent("gate")}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Parcours
          </button>
          <p className="topic-flow-context">
            Propositions faites
            <small>
              {p.demo ? "Parcours d’exemple" : `${p.title}, ${p.type}`}
            </small>
          </p>
        </div>
        {!hasProposals ? (
          <section className="cp-card">
            <h3>Archive vide</h3>
            <p>{emptyArchiveMessage()}</p>
            <div className="cp-actions">
              <button
                className="primary"
                onClick={() => {
                  setFreshStart(true);
                  setIntent("start");
                }}
              >
                Solliciter une aide <i className="fa-solid fa-arrow-right" />
              </button>
            </div>
          </section>
        ) : (
          <div className="topic-archive">
            <div className="cp-heading">
              <h2>Archive des propositions</h2>
              <p>
                Chaque sollicitation présente les trois sujets en onglets. Sur
                le sujet choisi, téléchargez le projet et le plan générés.
              </p>
            </div>
            {topicArchive.map((entry) => {
              const pType = normalizeProjectType(entry.projectType);
              const chosenAxis = entry.chosenTopic?.axis;
              const activeAxis = archiveActiveAxis(entry);
              const activeTopic =
                entry.topics.find((t) => t.axis === activeAxis) ||
                entry.topics[0];
              const activeIsChosen = Boolean(
                activeTopic && chosenAxis === activeTopic.axis,
              );
              const entryDay = new Date(entry.at).toDateString();
              const sameDay = topicArchive.filter(
                (e) => new Date(e.at).toDateString() === entryDay,
              );
              const sameDayIndex =
                sameDay.length > 1
                  ? sameDay
                      .slice()
                      .sort(
                        (a, b) =>
                          new Date(a.at).getTime() - new Date(b.at).getTime(),
                      )
                      .findIndex((e) => e.id === entry.id) + 1
                  : 0;
              const dayLabel = new Date(entry.at).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              });
              const archiveTitle =
                sameDay.length > 1
                  ? `Propositions du ${dayLabel} · n° ${sameDayIndex}`
                  : `Propositions du ${dayLabel}`;
              return (
                <section className="cp-card topic-archive-entry" key={entry.id}>
                  <div className="panelhead topic-archive-panelhead">
                    <div className="topic-archive-heading">
                      <h3>{archiveTitle}</h3>
                      <small className="topic-meta">
                        {[
                          sameDay.length > 1
                            ? new Date(entry.at).toLocaleTimeString("fr-FR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : null,
                          entry.model,
                          entry.simulated ? "Simulation" : null,
                          entry.chosenTopic
                            ? `Choisi : ${AXIS_LABEL[entry.chosenTopic.axis] || entry.chosenTopic.axis}`
                            : "Sans choix",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="secondary topic-archive-delete"
                      disabled={busy}
                      onClick={() => void deleteArchiveEntry(entry.id)}
                    >
                      <i
                        className="fa-solid fa-trash-can"
                        aria-hidden="true"
                      />{" "}
                      Supprimer
                    </button>
                  </div>

                  <div
                    className="topic-archive-tabs"
                    role="tablist"
                    aria-label="Trois sujets proposés"
                  >
                    {entry.topics.map((t) => {
                      const selected = activeAxis === t.axis;
                      const isChosen = chosenAxis === t.axis;
                      return (
                        <button
                          key={t.axis}
                          type="button"
                          role="tab"
                          id={`archive-tab-${entry.id}-${t.axis}`}
                          aria-selected={selected}
                          aria-controls={`archive-panel-${entry.id}-${t.axis}`}
                          tabIndex={selected ? 0 : -1}
                          className={
                            selected
                              ? "topic-archive-tab is-active"
                              : "topic-archive-tab"
                          }
                          onClick={() =>
                            setArchiveActiveAxis(entry.id, t.axis)
                          }
                        >
                          <span>
                            {AXIS_LABEL[t.axis] || t.axis}
                            {isChosen ? (
                              <em className="topic-archive-tab-chosen">
                                Choisi
                              </em>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {activeTopic ? (
                    <div
                      role="tabpanel"
                      id={`archive-panel-${entry.id}-${activeTopic.axis}`}
                      aria-labelledby={`archive-tab-${entry.id}-${activeTopic.axis}`}
                      className={
                        activeIsChosen
                          ? "topic-archive-panel is-chosen"
                          : "topic-archive-panel"
                      }
                    >
                      <div className="topic-archive-topic-head">
                        <span
                          className="topic-archive-topic-title"
                          title={activeTopic.title}
                        >
                          {activeTopic.title}
                        </span>
                        <span className="topic-axis">
                          {AXIS_LABEL[activeTopic.axis] || activeTopic.axis}
                        </span>
                        {activeIsChosen ? (
                          <em className="topic-archive-chosen-tag">
                            Sujet choisi
                          </em>
                        ) : null}
                      </div>
                      {activeTopic.research_question ? (
                        <small
                          className="topic-archive-topic-q"
                          title={activeTopic.research_question}
                        >
                          {activeTopic.research_question}
                        </small>
                      ) : null}
                      {activeTopic.pitch ? (
                        <p className="topic-archive-topic-pitch">
                          {activeTopic.pitch}
                        </p>
                      ) : null}

                      {activeIsChosen ? (
                        entry.documents?.length ? (
                          <div className="topic-archive-files">
                            <strong>Fichiers du sujet</strong>
                            <p className="topic-archive-doc-hint">
                              Téléchargez le projet et le plan tels qu’ils ont
                              été générés pour ce sujet.
                            </p>
                            <div className="topic-doc-download">
                              {entry.documents.map((doc) => (
                                <button
                                  key={doc.kind}
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void downloadArchiveDocument(entry, doc)
                                  }
                                >
                                  <i
                                    className="fa-solid fa-download"
                                    aria-hidden="true"
                                  />{" "}
                                  Télécharger{" "}
                                  {documentKindLabel(doc.kind, pType)} (Word)
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="topic-archive-empty">
                            Projet / plan non archivés pour ce sujet.
                          </p>
                        )
                      ) : (
                        <p className="topic-archive-empty">
                          {entry.chosenTopic
                            ? "Les fichiers projet et plan sont disponibles sur l’onglet du sujet choisi."
                            : "Aucun sujet n’a encore été retenu pour cette sollicitation."}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="topic-archive-empty">
                      Aucune proposition conservée.
                    </p>
                  )}
                </section>
              );
            })}
            <div className="cp-actions">
              <button
                className="primary"
                onClick={() => {
                  setFreshStart(true);
                  setIntent("start");
                }}
              >
                Nouvelle sollicitation{" "}
                <i className="fa-solid fa-arrow-right" />
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  if (mode === "corpus" && intent === "resume") {
    const corpusProjects = projects.filter((x) => !x.demo);
    const listed = corpusProjects.length ? corpusProjects : projects;

    function goToProject(projectId: string, next: "start" | "resume" | "plan") {
      if (projectId === p.id) {
        setIntent(next === "resume" ? "resume" : next);
        return;
      }
      if (next === "start") keepCorpusStartFlow();
      else keepCorpusProjectsFlow(next === "plan" ? "plan" : "resume");
      selectProject(projectId);
    }

    function openMaterial(projectId: string, materialId: string) {
      if (projectId === p.id) {
        const m = (p.materials || []).find((x: any) => x.id === materialId);
        if (m) open(m);
        return;
      }
      try {
        sessionStorage.setItem(OPEN_MATERIAL_KEY, materialId);
      } catch {
        /* ignore */
      }
      keepCorpusProjectsFlow("resume");
      selectProject(projectId);
    }

    return (
      <section className="cp-flow topic-flow">
        {confirmDialog}
        <div className="topic-flow-bar">
          <button
            type="button"
            className="secondary topic-back"
            onClick={() => setIntent("gate")}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Parcours
          </button>
          <p className="topic-flow-context">
            Mes projets
            <small>Matériaux et plans regroupés par projet</small>
          </p>
        </div>

        <div className="cp-heading">
          <h2>Mes projets</h2>
          <p>
            Ouvrez un bloc pour consulter le cadrage, les matériaux et le plan
            d’un projet. Les titres sont colorés pour les distinguer.
          </p>
        </div>

        {msg && (
          <p role="status" className="cp-message">
            {msg}
          </p>
        )}

        {!listed.length ? (
          <section className="cp-card">
            <h3>Aucun projet pour l’instant</h3>
            <p>
              Créez un projet personnel, puis déposez vos matériaux et demandez
              un plan de rédaction.
            </p>
            <div className="cp-actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setFreshStart(true);
                  setIntent("start");
                }}
              >
                Démarrer <i className="fa-solid fa-arrow-right" />
              </button>
            </div>
          </section>
        ) : (
          <div className="corpus-projects">
            {listed.map((project, index) => {
              const materials = project.materials || [];
              const frame = project.frame || {};
              const frameLabel = [
                frame.documentType &&
                  documentTypeLabel(
                    frame.documentType,
                    frame.documentTypeOther,
                  ),
                frame.discipline &&
                  disciplineLabel(frame.discipline, frame.disciplineOther),
                frame.expectedLength &&
                  expectedLengthLabel(frame.expectedLength),
                frame.writingTime && writingTimeLabel(frame.writingTime),
              ]
                .filter(Boolean)
                .join(" · ");
              const isCurrent = project.id === p.id;
              const isOpen = corpusProjectOpen(project.id, index);
              const titleColor =
                PROJECT_TITLE_COLORS[index % PROJECT_TITLE_COLORS.length];

              return (
                <section
                  key={project.id}
                  className={
                    "cp-card corpus-project-block" +
                    (isCurrent ? " is-current" : "") +
                    (isOpen ? " is-open" : "")
                  }
                  style={{ ["--project-title" as string]: titleColor }}
                >
                  <div className="corpus-project-head">
                    <button
                      type="button"
                      className="corpus-project-toggle"
                      aria-expanded={isOpen}
                      onClick={() => toggleCorpusProject(project.id, index)}
                    >
                      <span>
                        <h3>{project.title}</h3>
                        <small>
                          {project.type}
                          {project.demo ? " · Exemple" : ""}
                          {isCurrent ? " · Projet ouvert" : ""}
                          {" · "}
                          {materials.length}{" "}
                          {materials.length > 1 ? "matériaux" : "matériau"}
                          {project.plan ? " · Plan disponible" : ""}
                        </small>
                      </span>
                      <i
                        className={
                          "fa-solid " +
                          (isOpen ? "fa-chevron-up" : "fa-chevron-down")
                        }
                        aria-hidden="true"
                      />
                    </button>
                    <div className="corpus-project-head-actions">
                      {!isCurrent && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => goToProject(project.id, "resume")}
                        >
                          Ouvrir
                        </button>
                      )}
                      {!project.demo && (
                        <button
                          type="button"
                          className="secondary corpus-project-delete"
                          disabled={busy}
                          onClick={() =>
                            void removeCorpusProject(
                              project.id,
                              project.title,
                            )
                          }
                        >
                          <i
                            className="fa-solid fa-trash-can"
                            aria-hidden="true"
                          />{" "}
                          Supprimer
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    className={
                      "corpus-project-collapse" + (isOpen ? " is-open" : "")
                    }
                  >
                    <div className="corpus-project-collapse-inner">
                      <div className="corpus-project-section">
                        <div className="panelhead">
                          <h4>Cadrage</h4>
                          {isCurrent && (
                            <button
                              type="button"
                              className="secondary corpus-section-action"
                              disabled={busy}
                              onClick={() => void openCorpusEditor("frame")}
                            >
                              <i
                                className="fa-solid fa-pen-to-square"
                                aria-hidden="true"
                              />{" "}
                              Modifier
                            </button>
                          )}
                        </div>
                        {frameLabel || frame.brief ? (
                          <>
                            {frameLabel && <p>{frameLabel}</p>}
                            {frame.brief && (
                              <p
                                className="corpus-project-brief"
                                title={frame.brief}
                              >
                                {previewBrief(frame.brief)}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="corpus-project-empty">
                            Pas encore de cadrage sur ce projet.
                          </p>
                        )}
                      </div>

                      <div className="corpus-project-section">
                        <div className="panelhead">
                          <h4>
                            Matériaux
                            {materials.length ? ` · ${materials.length}` : ""}
                          </h4>
                          {isCurrent && (
                            <div className="corpus-section-actions">
                              <button
                                type="button"
                                className="secondary corpus-section-action"
                                disabled={busy}
                                onClick={() => void openCorpusEditor("materials")}
                              >
                                <i
                                  className="fa-solid fa-folder-open"
                                  aria-hidden="true"
                                />{" "}
                                Gérer
                              </button>
                              <button
                                type="button"
                                className="secondary corpus-section-action"
                                disabled={busy}
                                onClick={add}
                              >
                                <i
                                  className="fa-solid fa-plus"
                                  aria-hidden="true"
                                />{" "}
                                Ajouter
                              </button>
                            </div>
                          )}
                        </div>
                        {materials.length ? (
                          <div className="corpus-project-materials">
                            {materials.map((m) => (
                              <button
                                type="button"
                                className="listrow"
                                key={m.id}
                                onClick={() =>
                                  openMaterial(project.id, m.id)
                                }
                              >
                                <i
                                  className="fa-solid fa-file-lines"
                                  aria-hidden="true"
                                />
                                <span>
                                  {m.title}
                                  <small>
                                    {materialCode(m)} · {m.type}
                                  </small>
                                </span>
                                <span className="pill">
                                  {m.hasText
                                    ? "Texte disponible"
                                    : "À documenter"}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="corpus-project-empty">
                            Aucun matériau déposé.
                          </p>
                        )}
                      </div>

                      <div className="corpus-project-section">
                        <div className="panelhead">
                          <h4>Plan de rédaction</h4>
                        </div>
                        {project.plan ? (
                          <>
                            <p>
                              {project.plan.simulated
                                ? "Aperçu simulé"
                                : "Plan"}{" "}
                              du{" "}
                              {project.plan.date
                                ? new Date(project.plan.date).toLocaleString(
                                    "fr-FR",
                                  )
                                : "—"}
                              {project.plan.sections
                                ? ` · ${project.plan.sections} section${
                                    project.plan.sections > 1 ? "s" : ""
                                  }`
                                : ""}
                              {project.plan.model
                                ? ` · ${project.plan.model}`
                                : ""}
                            </p>
                            <div className="cp-actions">
                              <button
                                type="button"
                                className="primary"
                                onClick={() =>
                                  goToProject(project.id, "plan")
                                }
                              >
                                Ouvrir le plan{" "}
                                <i className="fa-solid fa-arrow-right" />
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={
                                  busy ||
                                  !(
                                    project.plan?.data?.sections?.length ||
                                    (project.id === p.id &&
                                      (draft.corpusResult || result)
                                        ?.sections?.length)
                                  )
                                }
                                onClick={() =>
                                  void downloadProjectDoc(project, "plan")
                                }
                              >
                                <i
                                  className="fa-solid fa-file-word"
                                  aria-hidden="true"
                                />{" "}
                                Plan rédaction
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void downloadProjectDoc(project, "schedule")
                                }
                              >
                                <i
                                  className="fa-solid fa-file-word"
                                  aria-hidden="true"
                                />{" "}
                                Planning
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  void openCorpusEditor("plan", project.id)
                                }
                              >
                                Relancer
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="corpus-project-empty">
                              Pas encore de plan sur ce projet.
                            </p>
                            <div className="cp-actions">
                              <button
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  void openCorpusEditor("plan", project.id)
                                }
                              >
                                Demander un plan{" "}
                                <i className="fa-solid fa-arrow-right" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <div className="cp-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setCorpusEntryStep(null);
              setFreshStart(true);
              setIntent("start");
            }}
          >
            Nouveau dépôt <i className="fa-solid fa-arrow-right" />
          </button>
          <button
            type="button"
            className="secondary"
            onClick={createProject}
          >
            Créer un projet
          </button>
        </div>
      </section>
    );
  }

  async function regeneratePlan(feedback: string) {
    if (busy || !mode || mode !== "corpus") return;
    if (p.demo) {
      notice("Choisissez un projet personnel pour regénérer un plan.");
      return;
    }
    wait(true);
    notice("");
    try {
      const prepared = {
        ...draft,
        corpusProjectConfirmed: true,
        corpusNoticeAccepted: true,
        corpusAiAccepted: true,
        corpusPrivacyAccepted: true,
      };
      set(prepared);
      await persistDraft(prepared);
      agree(true);
      const previousPlan = (result?.sections || []).map((s: any) => ({
        title: s.title,
        advice: s.advice,
      }));
      const nextResult = await runResearchRequest({
        simulate: simulatePlan,
        revisionFeedback: feedback,
        previousPlan,
      });
      const next = {
        ...prepared,
        corpusResult: {
          ...nextResult,
          revisionFeedback: feedback,
        },
      };
      set(next);
      await save(next);
      notice(
        nextResult.simulated
          ? "Aperçu révisé enregistré (simulation)."
          : "Plan révisé enregistré. Vérifiez les sections avant de les retenir.",
      );
    } catch (e: any) {
      notice(e.message || "Regénération impossible.");
      throw e;
    } finally {
      wait(false);
    }
  }

  if (mode === "corpus" && intent === "plan" && result) {
    return (
      <>
        <WritingPlanView
          p={p}
          draft={draft}
          result={result}
          busy={busy}
          onBack={() => setIntent("resume")}
          onOpenPassage={(payload) => read(payload)}
          onRegenerate={regeneratePlan}
        />
        {reading && (
          <SourcePassageDialog
            reading={reading}
            onClose={() => read(null)}
          />
        )}
      </>
    );
  }

  if (mode === "design" && intent === "start" && (!draft.chosenTopic || freshStart)) {
    return (
      <section className="cp-flow topic-flow">
        <div className="topic-flow-bar">
          <button
            type="button"
            className="secondary topic-back"
            onClick={() => setIntent("gate")}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Parcours
          </button>
          <p className="topic-flow-context">
            Étape 1 : Choisir un sujet
            <small>
              {p.demo ? "Nouveau parcours" : `${p.title}, ${p.type}`}
            </small>
          </p>
        </div>
        <TopicGenerator
          goPrivacy={() => go("Politique de confidentialité")}
          onTopicsGenerated={recordTopicsGenerated}
          onChooseTopic={async (topic, docs, sessionId, answers) => {
            setFreshStart(false);
            await chooseTopic(topic, docs, sessionId, answers);
            setIntent("resume");
          }}
        />
      </section>
    );
  }

  if (mode === "design") {
    return (
      <section className="cp-flow topic-flow">
        <div className="topic-flow-bar">
          <button
            type="button"
            className="secondary topic-back"
            onClick={() => setIntent("gate")}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Parcours
          </button>
          <p className="topic-flow-context">
            Construction du projet
            <small>
              {p.demo ? "Nouveau parcours" : `${p.title}, ${p.type}`}
            </small>
          </p>
        </div>
        <section className="cp-card">
          <h3>Parcours terminé pour cette sollicitation</h3>
          <p>
            Le sujet, le projet et le plan ont été générés. Consultez-les dans
            « Propositions faites ». Aucun cadrage supplémentaire n’est demandé.
          </p>
          <div className="cp-actions">
            <button
              className="secondary"
              onClick={() => setIntent("resume")}
            >
              Voir les propositions
            </button>
            <button
              className="primary"
              onClick={() => {
                setFreshStart(true);
                setIntent("start");
              }}
            >
              Nouvelle sollicitation{" "}
              <i className="fa-solid fa-arrow-right" />
            </button>
          </div>
        </section>
      </section>
    );
  }

  const jobPanel =
    jobProgress && mode === "corpus" ? (
      <div className="corpus-job-progress" role="status">
        <h3>Analyse en cours</h3>
        <p>
          {JOB_STEP_LABELS[jobProgress.step] || jobProgress.step}
          {jobProgress.progress.total > 0
            ? ` — ${jobProgress.progress.done.toLocaleString("fr-FR")} / ${jobProgress.progress.total.toLocaleString("fr-FR")} unités`
            : ""}
        </p>
        {jobProgress.progress.total > 0 && (
          <div className="bar" aria-hidden="true">
            <span
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    (100 * jobProgress.progress.done) /
                      Math.max(1, jobProgress.progress.total),
                  ),
                )}%`,
              }}
            />
          </div>
        )}
        <div className="cp-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void cancelActiveJob()}
          >
            Annuler
          </button>
        </div>
      </div>
    ) : null;

  return (
    <>
      {confirmDialog}
      {jobPanel}
      <CorpusOrganizer
        p={p}
        projects={projects}
        draft={draft}
        update={update}
        busy={busy || Boolean(jobProgress)}
        ready={ready}
        msg={msg}
        consent={consent}
        agree={agree}
        external={external}
        search={search}
        simulatePlan={simulatePlan}
        setSimulatePlan={setSimulatePlan}
        query={query}
        setQuery={setQuery}
        preferBatch={preferBatch}
        setPreferBatch={setPreferBatch}
        persist={persist}
        add={add}
        open={open}
        createProject={createProject}
        selectProject={selectProject}
        initialStep={corpusEntryStep}
        onBack={() => {
          setCorpusEntryStep(null);
          setIntent("gate");
        }}
        goPrivacy={() => go("Politique de confidentialité")}
        goTopics={() => {
          setCorpusEntryStep(null);
          go("Construire mon projet");
        }}
        onAbandon={() => void abandonCorpusStart()}
        onPlanReady={async () => {
          try {
            await resetCorpusStart(false);
          } catch {
            /* le plan est déjà enregistré */
          }
          setCorpusEntryStep(null);
          setIntent("plan");
        }}
      />
    </>
  );
}
