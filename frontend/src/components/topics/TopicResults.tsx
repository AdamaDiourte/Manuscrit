import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  DocumentKind,
  GeneratedTopic,
  RegenReason,
  TopicAxis,
  TopicConsents,
  TopicDocument,
  VerifiedReading,
} from "../../../../shared/research/topicTypes";
import { REGEN_REASON_LABELS } from "../../../../shared/research/topicTypes";
import {
  documentKindLabel,
  mainDocumentLabel,
  normalizeProjectType,
} from "../../../../shared/research/documentStructures";
import { writingStructureFor } from "../../../../shared/research/corpusOrganization";
import {
  buildWorkPlanFromTopic,
  type WorkPlan,
} from "../../../../shared/research/workPlan";
import { computeTimeBudget } from "../../../../shared/research/timeBudget";
import { fieldworkAvailableHours } from "../../../../shared/research/fieldworkCosts";
import { downloadDocx } from "./downloadDocx";
import WorkPlanView from "../copilot/WorkPlanView";

type DocPrepStatus = "pending" | "ready" | "error";

type DocPrepState = {
  kind: DocumentKind;
  status: DocPrepStatus;
  file?: DocFile;
  error?: string;
};

const AXIS_LABEL: Record<TopicAxis, string> = {
  mastery: "Maîtrise",
  ambition: "Ambition",
  discovery: "Découverte",
};

export type DocFile = {
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  base64: string;
};

type Bibliography = {
  cited: VerifiedReading[];
  other: VerifiedReading[];
};

type Props = {
  topics: GeneratedTopic[];
  ticket: string;
  regenerationsRemaining: number;
  model?: string;
  simulated?: boolean;
  personalizationLevel?: "high" | "medium" | "low";
  reviewStatus?: "ok" | "failed";
  axisStatus?: Partial<Record<TopicAxis, "pending" | "done" | "error">>;
  answers: Record<string, unknown>;
  consents: TopicConsents;
  busy: boolean;
  error: string;
  onTopicsUpdate?: (topics: GeneratedTopic[]) => void;
  onRegenerate: (axis: TopicAxis, reason: RegenReason) => void;
  onRestart: () => void;
  onEditProfile?: () => void;
  onChooseTopic?: (
    topic: GeneratedTopic,
    docs: DocFile[],
  ) => void | Promise<void>;
  onBusy: (busy: boolean) => void;
  onError: (error: string) => void;
};

function scrollFormTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
  document
    .querySelector(".topic-flow, .topic-phase, .cp-flow")
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function ClampText({
  children,
  lines = 3,
}: {
  children: ReactNode;
  lines?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={"topic-clamp" + (expanded ? " is-expanded" : "")}>
      <div
        className="topic-clamp-body"
        style={
          expanded
            ? undefined
            : ({ WebkitLineClamp: lines } as CSSProperties)
        }
      >
        {children}
      </div>
      <button
        type="button"
        className="topic-clamp-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Réduire" : "Lire la suite"}
      </button>
    </div>
  );
}

function ReadingsBlock({
  readings,
  loading,
  keywords,
}: {
  readings: VerifiedReading[];
  loading: boolean;
  keywords: string[];
}) {
  const [open, setOpen] = useState(false);
  if (loading) {
    return (
      <p className="topic-readings-loading" role="status">
        Recherche de lectures vérifiées…
      </p>
    );
  }
  if (!readings.length) {
    return (
      <div className="topic-readings-empty">
        <p>
          Aucune lecture suffisamment proche de ce sujet n’a été retenue.
          Utilisez ces mots-clés pour une recherche manuelle :
        </p>
        {keywords.length > 0 ? (
          <p className="topic-keywords">
            {keywords.map((k) => (
              <span key={k}>{k}</span>
            ))}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="topic-readings">
      <button
        type="button"
        className="topic-readings-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Pistes de lecture (références réelles issues d’OpenAlex et HAL)
      </button>
      {open && (
        <div className="topic-readings-body">
          <p className="topic-readings-note">
            Trouvées automatiquement à partir des mots-clés : vérifiez leur
            pertinence avant de les citer.
          </p>
          <ul>
            {readings.map((r) => (
              <li key={r.url + r.title}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.authors.length
                    ? `${r.authors.join(", ")}${r.year ? ` (${r.year})` : ""}. `
                    : ""}
                  {r.title}
                </a>
                {r.venue ? <span> — {r.venue}</span> : null}
                <span className="topic-reading-source"> [{r.source}]</span>
                {r.relevance_reason ? (
                  <p className="topic-reading-reason">{r.relevance_reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BibliographyPreview({ bibliography }: { bibliography: Bibliography }) {
  const hasCited = bibliography.cited.length > 0;
  const hasOther = bibliography.other.length > 0;
  if (!hasCited && !hasOther) return null;
  return (
    <div className="topic-bibliography-preview">
      {hasCited ? (
        <div>
          <h3>Références citées</h3>
          <ul>
            {bibliography.cited.map((r) => (
              <li key={"c-" + r.url + r.title}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.authors.length ? `${r.authors.join(", ")}. ` : ""}
                  {r.title}
                  {r.year ? ` (${r.year})` : ""}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasOther ? (
        <div>
          <h3>Autres pistes de lecture</h3>
          <ul>
            {bibliography.other.map((r) => (
              <li key={"o-" + r.url + r.title}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.authors.length ? `${r.authors.join(", ")}. ` : ""}
                  {r.title}
                  {r.year ? ` (${r.year})` : ""}
                </a>
                {r.relevance_reason ? (
                  <p className="topic-reading-reason">{r.relevance_reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function TopicResults({
  topics,
  ticket,
  regenerationsRemaining,
  simulated,
  personalizationLevel,
  reviewStatus,
  axisStatus,
  answers,
  consents,
  busy,
  error,
  onTopicsUpdate,
  onRegenerate,
  onRestart,
  onEditProfile,
  onChooseTopic,
  onBusy,
  onError,
}: Props) {
  const [reasons, setReasons] = useState<
    Partial<Record<TopicAxis, RegenReason | "">>
  >({});
  const [chosen, setChosen] = useState<GeneratedTopic | null>(null);
  const [docPrep, setDocPrep] = useState<DocPrepState[]>([]);
  const docPrepRef = useRef<DocPrepState[]>([]);
  const [preparingDocs, setPreparingDocs] = useState(false);

  useEffect(() => {
    docPrepRef.current = docPrep;
  }, [docPrep]);
  const [workPlanPreview, setWorkPlanPreview] = useState<WorkPlan | null>(null);
  const [bibliography, setBibliography] = useState<Bibliography | null>(null);
  const [pendingAxis, setPendingAxis] = useState<TopicAxis | "">("");
  const [regenAxis, setRegenAxis] = useState<TopicAxis | "">("");
  const [readingsLoading, setReadingsLoading] = useState<
    Partial<Record<TopicAxis, boolean>>
  >({});

  useEffect(() => {
    if (!busy) {
      setPendingAxis("");
      setRegenAxis("");
    }
  }, [busy]);

  const topicsFingerprint = topics
    .map((t) => t.axis + ":" + t.title)
    .join("|");

  useEffect(() => {
    if (!ticket || !topics.length) return;
    const pending = topics.filter((t) => t.readings === undefined);
    if (!pending.length) return;
    let cancelled = false;
    setReadingsLoading(
      Object.fromEntries(pending.map((t) => [t.axis, true])) as Partial<
        Record<TopicAxis, boolean>
      >,
    );

    void (async () => {
      const results = await Promise.all(
        pending.map(async (topic) => {
          try {
            const res = await fetch("/api/topics/readings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ticket,
                axis: topic.axis,
                answers,
                consents,
              }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Lectures impossibles.");
            return {
              axis: topic.axis,
              readings: (data.readings || []) as VerifiedReading[],
              literature_density: data.literature_density as
                | "high"
                | "normal"
                | "unknown"
                | undefined,
            };
          } catch {
            return {
              axis: topic.axis,
              readings: [] as VerifiedReading[],
              literature_density: "unknown" as const,
            };
          }
        }),
      );
      if (cancelled) return;
      const byAxis = new Map(
        results.map((r) => [
          r.axis,
          {
            readings: r.readings,
            literature_density: r.literature_density,
          },
        ]),
      );
      onTopicsUpdate?.(
        topics.map((t) => {
          const hit = byAxis.get(t.axis);
          if (!hit) return t;
          return {
            ...t,
            readings: hit.readings || [],
            literature_density: hit.literature_density || t.literature_density,
          };
        }),
      );
      setReadingsLoading({});
    })();

    return () => {
      cancelled = true;
    };
    // Re-fetch when ticket or topic titles change (e.g. after regen).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- answers/consents stable per session
  }, [ticket, topicsFingerprint]);

  async function fetchDocument(topic: GeneratedTopic, kind: DocumentKind) {
    const res = await fetch("/api/topics/document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        ticket,
        topic: { ...topic, readings: undefined },
        answers,
        consents,
        ...(simulated ? { simulate: true } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Document impossible.");
    return {
      file: {
        kind,
        filename: data.file.filename as string,
        mimeType: data.file.mimeType as string,
        base64: data.file.base64 as string,
      } satisfies DocFile,
      document: (data.document || null) as TopicDocument | null,
      bibliography: (data.bibliography || null) as Bibliography | null,
    };
  }

  function updateDocPrep(
    kind: DocumentKind,
    patch: Partial<DocPrepState>,
  ) {
    setDocPrep((prev) =>
      prev.map((d) => (d.kind === kind ? { ...d, ...patch } : d)),
    );
  }

  async function prepareOneDocument(
    topic: GeneratedTopic,
    kind: DocumentKind,
  ): Promise<DocFile | null> {
    updateDocPrep(kind, { status: "pending", error: undefined, file: undefined });
    try {
      const result = await fetchDocument(topic, kind);
      updateDocPrep(kind, { status: "ready", file: result.file, error: undefined });
      if (kind === "research_project") {
        setBibliography(result.bibliography);
      }
      if (kind === "work_plan") {
        const fromApi = result.document?.workPlan?.phases?.length
          ? result.document.workPlan
          : null;
        setWorkPlanPreview(
          fromApi ||
            buildWorkPlanFromTopic({
              answers,
              topic,
              sections: writingStructureFor(
                normalizeProjectType(answers.project_type),
              ),
            }),
        );
      }
      return result.file;
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : kind === "work_plan"
            ? "Le plan de travail n’a pas pu être préparé."
            : "Le projet de recherche n’a pas pu être préparé.";
      updateDocPrep(kind, {
        status: "error",
        error:
          kind === "work_plan"
            ? "Le plan de travail n’a pas pu être préparé."
            : "Le projet de recherche n’a pas pu être préparé.",
        file: undefined,
      });
      onError(message);
      return null;
    }
  }

  async function chooseTopic(topic: GeneratedTopic) {
    onError("");
    onBusy(true);
    setPendingAxis(topic.axis);
    setBibliography(null);
    setWorkPlanPreview(null);
    setChosen(topic);
    setPreparingDocs(true);
    setDocPrep([
      { kind: "research_project", status: "pending" },
      { kind: "work_plan", status: "pending" },
    ]);
    scrollFormTop();
    try {
      const [projectFile, planFile] = await Promise.all([
        prepareOneDocument(topic, "research_project"),
        prepareOneDocument(topic, "work_plan"),
      ]);
      const generated = [projectFile, planFile].filter(
        (f): f is DocFile => Boolean(f),
      );
      if (onChooseTopic && generated.length) {
        await onChooseTopic(topic, generated);
      }
    } finally {
      setPreparingDocs(false);
      onBusy(false);
      setPendingAxis("");
    }
  }

  async function retryDocument(kind: DocumentKind) {
    if (!chosen) return;
    onError("");
    onBusy(true);
    setPreparingDocs(true);
    try {
      const file = await prepareOneDocument(chosen, kind);
      if (file && onChooseTopic) {
        const ready = docPrepRef.current
          .filter((d) => d.status === "ready" && d.file)
          .map((d) => d.file!);
        await onChooseTopic(chosen, ready);
      }
    } finally {
      setPreparingDocs(false);
      onBusy(false);
    }
  }

  function requestRegen(axis: TopicAxis) {
    const reason = reasons[axis];
    if (!reason) {
      onError("Choisissez d’abord un motif avant de régénérer ce sujet.");
      return;
    }
    onError("");
    setRegenAxis(axis);
    onRegenerate(axis, reason);
    setReasons((r) => ({ ...r, [axis]: "" }));
  }

  const projectType = normalizeProjectType(answers.project_type);
  const mainLabel = mainDocumentLabel(projectType);
  const timeBudget = computeTimeBudget(answers);
  const availableFieldHours = fieldworkAvailableHours(timeBudget.totalHours);

  if (chosen) {
    return (
      <section className="topic-results topic-phase topic-chosen-docs">
        <div className="topic-section-head">
          <h2>Sujet retenu</h2>
          <p>
            {preparingDocs || docPrep.some((d) => d.status === "pending")
              ? "Préparation de votre projet de recherche et de votre plan de travail (environ 30 secondes)…"
              : `Le ${mainLabel.toLowerCase()} et le plan de travail sont prêts pour ce sujet. Téléchargez chaque fichier quand vous le souhaitez.`}
          </p>
        </div>

        <article className="topic-card panel topic-card-compact">
          <div className="panelhead">
            <h2 className="topic-card-title">
              <span className="topic-card-title-text">{chosen.title}</span>
              <span className="topic-axis">{AXIS_LABEL[chosen.axis]}</span>
            </h2>
          </div>
          <p className="topic-card-lead">{chosen.research_question}</p>
        </article>

        {error && <p role="alert">{error}</p>}

        <div className="topic-doc-download topic-doc-prep">
          {docPrep.map((doc) => {
            const label = documentKindLabel(doc.kind, projectType);
            const statusLabel =
              doc.status === "pending"
                ? "en cours"
                : doc.status === "ready"
                  ? "prêt"
                  : "échec";
            return (
              <div key={doc.kind} className="topic-doc-prep-row">
                <p className="topic-doc-prep-status" role="status">
                  {label} : {statusLabel}
                  {doc.error ? ` — ${doc.error}` : ""}
                </p>
                {doc.status === "ready" && doc.file ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      const result = downloadDocx(
                        doc.file!.base64,
                        doc.file!.filename,
                      );
                      if (!result.ok) {
                        onError(
                          `${label} : fichier invalide, retéléchargement impossible.`,
                        );
                      }
                    }}
                  >
                    Télécharger {label} (Word)
                  </button>
                ) : null}
                {doc.status === "error" ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void retryDocument(doc.kind)}
                  >
                    Réessayer
                  </button>
                ) : null}
                {doc.status === "pending" ? (
                  <button type="button" className="secondary" disabled>
                    Préparation…
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {workPlanPreview?.phases?.length ? (
          <div className="topic-workplan-preview">
            <WorkPlanView plan={workPlanPreview} />
          </div>
        ) : null}

        {bibliography ? (
          <BibliographyPreview bibliography={bibliography} />
        ) : null}

        <div className="topic-nav">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setChosen(null);
              setDocPrep([]);
              setPreparingDocs(false);
              setWorkPlanPreview(null);
              setBibliography(null);
              scrollFormTop();
            }}
          >
            Revenir aux sujets
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="topic-results topic-phase">
      <div className="topic-section-head">
        <h2>Trois sujets proposés</h2>
        <p>
          Comparez les grands axes, choisissez un sujet, ou régénérez-en un après
          avoir indiqué un motif. Le projet et le plan de travail sont générés
          uniquement après le choix.
        </p>
        <div className="topic-meta-row">
          <span className="topic-ai-badge">
            {simulated
              ? "Démonstration (données fictives)"
              : "Proposé par l'IA"}
          </span>
          <span className="topic-meta">
            Régénérations restantes : {regenerationsRemaining} / 3
          </span>
        </div>
      </div>

      {personalizationLevel === "low" && (
        <div className="topic-personalization-low" role="status">
          <p>
            Profil peu détaillé : ces sujets sont moins personnalisés. Complétez
            votre profil pour de meilleures propositions.
          </p>
          {onEditProfile && (
            <button
              type="button"
              className="secondary"
              onClick={onEditProfile}
            >
              Compléter mon profil
            </button>
          )}
        </div>
      )}

      {reviewStatus === "failed" ? (
        <p className="topic-review-failed" role="status">
          Relecture automatique indisponible pour cette génération.
        </p>
      ) : null}

      {error && <p role="alert">{error}</p>}

      <div className="topic-cards">
        {(["mastery", "ambition", "discovery"] as TopicAxis[]).map((axis) => {
          const topic = topics.find((t) => t.axis === axis);
          const status = axisStatus?.[axis] || (topic ? "done" : "pending");
          if (!topic || status === "pending") {
            return (
              <article
                key={axis}
                className="topic-card panel topic-card-compact topic-card-pending"
              >
                <div className="panelhead">
                  <h2 className="topic-card-title">
                    <span className="topic-card-title-text">
                      Préparation de ce sujet…
                    </span>
                    <span className="topic-axis">{AXIS_LABEL[axis]}</span>
                  </h2>
                </div>
                <p className="topic-pending-note" role="status">
                  Génération et relecture en cours pour l&apos;axe{" "}
                  {AXIS_LABEL[axis].toLowerCase()}.
                </p>
              </article>
            );
          }
          if (status === "error") {
            return (
              <article
                key={axis}
                className="topic-card panel topic-card-compact"
              >
                <div className="panelhead">
                  <h2 className="topic-card-title">
                    <span className="topic-card-title-text">
                      Sujet indisponible
                    </span>
                    <span className="topic-axis">{AXIS_LABEL[axis]}</span>
                  </h2>
                </div>
              </article>
            );
          }
          const reason = reasons[topic.axis] || "";
          const hasReason = Boolean(reason);
          const canRegen =
            hasReason && !busy && regenerationsRemaining > 0 && Boolean(ticket);
          const choosingThis = pendingAxis === topic.axis;
          const regeneratingThis = regenAxis === topic.axis;
          const readings = topic.readings ?? [];
          const loadingReadings =
            topic.readings === undefined ||
            Boolean(readingsLoading[topic.axis]);
          const keywordHints = [
            ...topic.keywords_fr.slice(0, 4),
            ...topic.keywords_en.slice(0, 2),
          ];
          return (
            <article
              key={topic.axis}
              className="topic-card panel topic-card-compact"
            >
              <div className="panelhead">
                <h2 className="topic-card-title">
                  <span className="topic-card-title-text">{topic.title}</span>
                  <span className="topic-axis">{AXIS_LABEL[topic.axis]}</span>
                </h2>
              </div>

              <div className="topic-card-axes">
                {topic.pitch ? (
                  <div className="topic-kv topic-pitch">
                    <strong>Pourquoi ce sujet</strong>
                    <ClampText lines={5}>
                      <p>{topic.pitch}</p>
                    </ClampText>
                  </div>
                ) : topic.rationale ? (
                  <div className="topic-kv topic-why">
                    <strong>Pourquoi ce sujet pour vous</strong>
                    <ClampText>
                      <p>{topic.rationale}</p>
                    </ClampText>
                  </div>
                ) : null}
                <div className="topic-kv">
                  <strong>Question</strong>
                  <ClampText>
                    <p>{topic.research_question}</p>
                  </ClampText>
                </div>
                {topic.stakes && topic.stakes.length > 0 ? (
                  <div className="topic-kv topic-stakes">
                    <strong>Enjeux</strong>
                    <ul>
                      {topic.stakes.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {topic.leads && topic.leads.length > 0 ? (
                  <div className="topic-kv topic-leads">
                    <strong>Pistes</strong>
                    <ul>
                      {topic.leads.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <details className="topic-details">
                  <summary>Détails du projet</summary>
                  <div className="topic-details-body">
                    {topic.context ? (
                      <div className="topic-kv topic-kv-context">
                        <strong>Contexte</strong>
                        <ClampText lines={4}>
                          <p>{topic.context}</p>
                        </ClampText>
                      </div>
                    ) : null}
                    {topic.research_object ? (
                      <div className="topic-kv">
                        <strong>Objet</strong>
                        <ClampText>
                          <p>{topic.research_object}</p>
                        </ClampText>
                      </div>
                    ) : null}
                    <div className="topic-kv">
                      <strong>Hypothèses</strong>
                      <ul>
                        {topic.hypotheses.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    </div>
                    {topic.hypothesis_tests &&
                    topic.hypothesis_tests.length > 0 ? (
                      <div className="topic-kv">
                        <strong>Comment tester les hypothèses</strong>
                        <ul>
                          {topic.hypothesis_tests.map((ht) => (
                            <li key={ht.hypothesis_index}>
                              <strong>H{ht.hypothesis_index + 1}</strong> —{" "}
                              {ht.comparison_or_variable}
                              {ht.data_source ? (
                                <span> · Donnée : {ht.data_source}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="topic-kv">
                      <strong>Terrain / corpus</strong>
                      <ClampText>
                        <p>{topic.field_or_corpus}</p>
                      </ClampText>
                    </div>
                    <div className="topic-kv">
                      <strong>Méthode</strong>
                      <ClampText>
                        <p>{topic.method}</p>
                      </ClampText>
                    </div>
                    {typeof topic.estimated_hours === "number" ? (
                      <p className="topic-fieldwork-hours" role="status">
                        Charge estimée de collecte et d&apos;analyse : ~
                        {topic.estimated_hours} h sur {availableFieldHours} h
                        disponibles
                      </p>
                    ) : null}
                    <div className="topic-kv topic-kv-inline">
                      <strong>Faisabilité</strong>
                      <p>
                        <span
                          className={
                            "topic-feasibility level-" +
                            topic.feasibility.level
                          }
                        >
                          {topic.feasibility.level === "high"
                            ? "Élevée"
                            : topic.feasibility.level === "medium"
                              ? "Moyenne"
                              : "Faible"}
                        </span>
                      </p>
                    </div>
                    {topic.feasibility.first_steps.length > 0 ? (
                      <div className="topic-kv">
                        <strong>Premières étapes</strong>
                        <ul>
                          {topic.feasibility.first_steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {topic.expected_contribution ? (
                      <div className="topic-kv">
                        <strong>Apport attendu</strong>
                        <ClampText>
                          <p>{topic.expected_contribution}</p>
                        </ClampText>
                      </div>
                    ) : null}
                    <div className="topic-keywords">
                      {topic.keywords_fr.slice(0, 6).map((k) => (
                        <span key={k}>{k}</span>
                      ))}
                    </div>
                    {topic.ethical_notes ? (
                      <div className="topic-kv">
                        <strong>Précautions éthiques</strong>
                        <ClampText>
                          <p>{topic.ethical_notes}</p>
                        </ClampText>
                      </div>
                    ) : null}
                    <ReadingsBlock
                      readings={readings}
                      loading={loadingReadings}
                      keywords={keywordHints}
                    />
                  </div>
                </details>

                {topic.literature_density === "high" ? (
                  <p className="topic-literature-density" role="status">
                    Thème déjà bien étudié : précisez ce que votre travail
                    apporte de nouveau.
                  </p>
                ) : null}
                {topic.warnings && topic.warnings.length > 0
                  ? topic.warnings.map((w, i) => (
                      <p
                        key={`${w.code}-${i}`}
                        className={
                          "topic-warning" +
                          (w.code === "UNDER_SCALE"
                            ? " topic-warning-under-scale"
                            : "")
                        }
                        role="status"
                      >
                        {w.message}
                      </p>
                    ))
                  : null}
              </div>

              <div className="topic-card-actions">
                <button
                  type="button"
                  className={
                    choosingThis ? "primary is-busy" : "primary"
                  }
                  disabled={busy || hasReason || !ticket}
                  aria-busy={choosingThis || undefined}
                  title={
                    hasReason
                      ? "Effacez le motif ou régénérez avant de choisir"
                      : !ticket
                        ? "Attendez la fin de la génération des trois sujets"
                        : undefined
                  }
                  onClick={() => chooseTopic(topic)}
                >
                  {choosingThis
                    ? "Génération du projet et du plan…"
                    : "Choisir ce sujet"}
                </button>

                <div className="topic-regen">
                  <label htmlFor={"regen-" + topic.axis}>
                    Motif pour régénérer
                  </label>
                  <div className="topic-regen-row">
                    <select
                      id={"regen-" + topic.axis}
                      value={reason}
                      disabled={busy || regenerationsRemaining <= 0}
                      onChange={(e) =>
                        setReasons((r) => ({
                          ...r,
                          [topic.axis]: e.target.value as RegenReason | "",
                        }))
                      }
                    >
                      <option value="">Choisir un motif…</option>
                      {(Object.keys(REGEN_REASON_LABELS) as RegenReason[]).map(
                        (k) => (
                          <option key={k} value={k}>
                            {REGEN_REASON_LABELS[k]}
                          </option>
                        ),
                      )}
                    </select>
                    <button
                      type="button"
                      className={
                        regeneratingThis
                          ? "topic-regen-btn is-busy"
                          : canRegen
                            ? "topic-regen-btn is-ready"
                            : "topic-regen-btn"
                      }
                      disabled={!canRegen || regeneratingThis}
                      aria-busy={regeneratingThis || undefined}
                      title={
                        regeneratingThis
                          ? "Régénération en cours"
                          : reason
                            ? "Régénérer uniquement ce sujet"
                            : "Sélectionnez un motif d’abord"
                      }
                      onClick={() => requestRegen(topic.axis)}
                    >
                      {regeneratingThis ? "Régénération…" : "Régénérer"}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="topic-nav">
        <button
          type="button"
          className="secondary"
          onClick={onRestart}
          disabled={busy}
        >
          Nouveau questionnaire
        </button>
      </div>
    </section>
  );
}
