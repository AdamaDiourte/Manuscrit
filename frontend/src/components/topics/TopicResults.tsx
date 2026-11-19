import { useEffect, useState } from "react";
import type {
  DocumentKind,
  GeneratedTopic,
  RegenReason,
  TopicAxis,
  TopicConsents,
  TopicDocument,
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
import { downloadBase64File } from "./downloadDocx";
import WorkPlanView from "../copilot/WorkPlanView";

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

type Props = {
  topics: GeneratedTopic[];
  regenerationsRemaining: number;
  model?: string;
  simulated?: boolean;
  answers: Record<string, unknown>;
  consents: TopicConsents;
  busy: boolean;
  error: string;
  onRegenerate: (axis: TopicAxis, reason: RegenReason) => void;
  onRestart: () => void;
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

export default function TopicResults({
  topics,
  regenerationsRemaining,
  model,
  simulated,
  answers,
  consents,
  busy,
  error,
  onRegenerate,
  onRestart,
  onChooseTopic,
  onBusy,
  onError,
}: Props) {
  const [reasons, setReasons] = useState<
    Partial<Record<TopicAxis, RegenReason | "">>
  >({});
  const [chosen, setChosen] = useState<GeneratedTopic | null>(null);
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [workPlanPreview, setWorkPlanPreview] = useState<WorkPlan | null>(null);
  const [pendingAxis, setPendingAxis] = useState<TopicAxis | "">("");
  const [regenAxis, setRegenAxis] = useState<TopicAxis | "">("");

  useEffect(() => {
    if (!busy) {
      setPendingAxis("");
      setRegenAxis("");
    }
  }, [busy]);

  async function fetchDocument(topic: GeneratedTopic, kind: DocumentKind) {
    const res = await fetch("/api/topics/document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        topic,
        answers,
        consents,
        simulate: Boolean(simulated),
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
    };
  }

  async function chooseTopic(topic: GeneratedTopic) {
    onError("");
    onBusy(true);
    setPendingAxis(topic.axis);
    try {
      const [project, plan] = await Promise.all([
        fetchDocument(topic, "research_project"),
        fetchDocument(topic, "work_plan"),
      ]);
      const generated = [project.file, plan.file];
      setDocs(generated);
      const fromApi = plan.document?.workPlan?.phases?.length
        ? plan.document.workPlan
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
      setChosen(topic);
      if (onChooseTopic) await onChooseTopic(topic, generated);
      else scrollFormTop();
    } catch (e: any) {
      onError(e.message || "Génération des documents impossible.");
    } finally {
      onBusy(false);
      setPendingAxis("");
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

  if (chosen) {
    return (
      <section className="topic-results topic-phase topic-chosen-docs">
        <div className="topic-section-head">
          <h2>Sujet retenu</h2>
          <p>
            Le {mainLabel.toLowerCase()} et le plan de travail ont été générés
            pour ce sujet. Le plan propose un planning d’organisation calé sur
            votre délai de rendu et le temps à consacrer au sujet par semaine.
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

        <div className="topic-doc-download">
          {docs.map((doc) => (
            <button
              key={doc.kind}
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                downloadBase64File(doc.filename, doc.mimeType, doc.base64)
              }
            >
              Télécharger{" "}
              {documentKindLabel(doc.kind, projectType)} (Word)
            </button>
          ))}
        </div>

        {workPlanPreview?.phases?.length ? (
          <div className="topic-workplan-preview">
            <WorkPlanView plan={workPlanPreview} />
          </div>
        ) : null}

        <div className="topic-nav">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setChosen(null);
              setDocs([]);
              setWorkPlanPreview(null);
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
          uniquement après le choix.{" "}
          <span className="topic-ai-badge">
            {simulated ? "Simulation" : "Contenu généré par IA"}
          </span>
          {model ? <span className="topic-meta"> · {model}</span> : null}
          <br />
          <span className="topic-meta">
            Régénérations restantes : {regenerationsRemaining} / 3
          </span>
        </p>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="topic-cards">
        {topics.map((topic) => {
          const reason = reasons[topic.axis] || "";
          const hasReason = Boolean(reason);
          const canRegen =
            hasReason && !busy && regenerationsRemaining > 0;
          const choosingThis = pendingAxis === topic.axis;
          const regeneratingThis = regenAxis === topic.axis;
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
                {(topic.context || topic.rationale) && (
                  <div className="topic-kv topic-kv-context">
                    <strong>Contexte</strong>
                    <p>{topic.context || topic.rationale}</p>
                  </div>
                )}
                <div className="topic-kv">
                  <strong>Question</strong>
                  <p>{topic.research_question}</p>
                </div>
                <div className="topic-kv">
                  <strong>Hypothèses</strong>
                  <ul>
                    {topic.hypotheses.slice(0, 2).map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
                <div className="topic-kv">
                  <strong>Terrain / corpus</strong>
                  <p>{topic.field_or_corpus}</p>
                </div>
                <div className="topic-kv">
                  <strong>Méthode</strong>
                  <p>{topic.method}</p>
                </div>
                <div className="topic-kv topic-kv-inline">
                  <strong>Faisabilité</strong>
                  <p>
                    <span
                      className={
                        "topic-feasibility level-" + topic.feasibility.level
                      }
                    >
                      {topic.feasibility.level === "high"
                        ? "Élevée"
                        : topic.feasibility.level === "medium"
                          ? "Moyenne"
                          : "Faible"}
                    </span>
                    {topic.feasibility.first_steps[0]
                      ? ` · ${topic.feasibility.first_steps[0]}`
                      : ""}
                  </p>
                </div>
                <div className="topic-keywords">
                  {topic.keywords_fr.slice(0, 4).map((k) => (
                    <span key={k}>{k}</span>
                  ))}
                </div>
              </div>

              <div className="topic-card-actions">
                <button
                  type="button"
                  className={
                    choosingThis ? "primary is-busy" : "primary"
                  }
                  disabled={busy || hasReason}
                  aria-busy={choosingThis || undefined}
                  title={
                    hasReason
                      ? "Effacez le motif ou régénérez avant de choisir"
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
