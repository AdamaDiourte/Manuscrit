import { useEffect, useRef, useState } from "react";
import {
  materialCode,
  materialText,
} from "../../../../shared/research/project";
import type { GeneratedTopic } from "../../../../shared/research/topicTypes";
import {
  documentKindLabel,
  normalizeProjectType,
} from "../../../../shared/research/documentStructures";
import Attestation from "./Attestation";
import TopicGenerator from "../topics/TopicGenerator";
import type { DocFile } from "../topics/TopicResults";
import { useConfirmDialog } from "../topics/ConfirmDialog";
import {
  emptyArchiveMessage,
  makeArchiveId,
  mergeTopicArchives,
  uploadArchivedDoc,
  type TopicArchiveEntry,
} from "../topics/topicArchive";

export type ResearchPage =
  | "Accueil"
  | "Construire mon projet"
  | "Organiser mon manuscrit";

type Mode = "design" | "corpus";
type Intent = "gate" | "start" | "resume";

type Props = {
  page: ResearchPage;
  p: any;
  ready: boolean;
  save: (draft: any) => Promise<void>;
  add: () => void;
  open: (m: any) => void;
  go: (page: string) => void;
};

function draftFromTopic(topic: GeneratedTopic) {
  return {
    chosenTopic: topic,
    interests: [
      topic.title,
      topic.research_question,
      "Mots-clés : " + topic.keywords_fr.join(", "),
    ].join("\n\n"),
    aims: [
      topic.research_question,
      ...(topic.hypotheses || []).map((h) => "Hypothèse : " + h),
      topic.rationale,
    ].join("\n\n"),
    methods: [
      "Terrain / corpus : " + topic.field_or_corpus,
      "Méthode : " + topic.method,
      "Faisabilité : " + topic.feasibility.level,
      "Premiers pas : " + topic.feasibility.first_steps.join(" ; "),
    ].join("\n\n"),
    literature: topic.keywords_fr.concat(topic.keywords_en).join(", "),
  };
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

function hasCorpusWork(draft: any, materials: any[]) {
  return Boolean(
    draft.brief ||
      draft.briefName ||
      draft.briefFile ||
      draft.corpusResult ||
      materials.length,
  );
}

export default function ResearchStudio({
  page,
  p,
  ready,
  save,
  add,
  open,
  go,
}: Props) {
  const mode = modeOf(page);
  const [intent, setIntent] = useState<Intent>("gate");
  const [freshStart, setFreshStart] = useState(false);
  const [projectFile, setProjectFile] = useState<File | null>(null);
  const [openProposals, setOpenProposals] = useState<Record<string, boolean>>(
    {},
  );
  const [draft, set] = useState<any>(p.copilot || {}),
    [consent, agree] = useState(false),
    [external, search] = useState(false),
    [query, setQuery] = useState(""),
    [busy, wait] = useState(false),
    [msg, notice] = useState(""),
    [reading, read] = useState<any>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

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

  function proposalsOpen(entryId: string, index: number) {
    if (Object.prototype.hasOwnProperty.call(openProposals, entryId)) {
      return openProposals[entryId];
    }
    return index === 0;
  }

  function toggleProposals(entryId: string, index: number) {
    setOpenProposals((prev) => {
      const currently = Object.prototype.hasOwnProperty.call(prev, entryId)
        ? prev[entryId]
        : index === 0;
      return { ...prev, [entryId]: !currently };
    });
  }

  const update = (key: string, value: any) => {
    set((d: any) => ({ ...d, [key]: value }));
    notice("");
  };

  async function persist(run: boolean) {
    if (busy || !mode) return;
    wait(true);
    notice("");
    try {
      if (!consent) throw Error("Confirmez les conditions de dépôt.");
      let savedDraft = draft;
      if (projectFile) {
        const upload = await fetch(
          "/api/workspace?upload=1&name=" +
            encodeURIComponent(projectFile.name),
          {
            method: "POST",
            headers: { "X-Deposit-Attested": "yes" },
            body: projectFile,
          },
        );
        if (!upload.ok)
          throw Error("Le fichier du projet n’a pas pu être déposé.");
        const { id } = (await upload.json()) as { id: string };
        savedDraft = { ...draft, briefFile: id };
        set(savedDraft);
        setProjectFile(null);
      }
      await save(savedDraft);
      if (!run) {
        notice("Cadrage enregistré dans ce projet.");
        return;
      }
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: p.id,
          mode,
          consent,
          publicQuery: external ? query : "",
        }),
      });
      const result = (await response.json()) as any;
      if (!response.ok) throw Error(result.error);
      const next = { ...savedDraft, [mode + "Result"]: result };
      set(next);
      await save(next);
      notice(
        "Proposition enregistrée. Examinez chaque piste avant de la retenir.",
      );
    } catch (e: any) {
      notice(e.message || "Enregistrement impossible.");
    } finally {
      wait(false);
    }
  }

  async function importBrief(file?: File) {
    if (!file) return;
    try {
      const { extractText } = await import("../../services/import/extractText");
      const text = await extractText(file);
      if (text.length > 30000)
        throw Error(
          "Le projet dépasse 30 000 caractères. Importez une synthèse.",
        );
      update("brief", text);
      update("briefName", file.name);
      setProjectFile(file);
    } catch (e: any) {
      notice(e.message);
    }
  }

  const result = mode ? draft[mode + "Result"] : null;
  const corpusReady = hasCorpusWork(draft, p.materials || []);
  const topicArchive = archiveList(draft);
  const hasProposals = topicArchive.length > 0;

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
    const nextDraft = {
      ...current,
      ...draftFromTopic(topic),
      topicArchive: nextArchive,
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
              Du corpus au plan argumenté, avec des extraits vérifiables et des
              pistes de discussion.
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
    const resumeReady = corpusReady;
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
              : "Démarrez l’organisation du corpus, ou reprenez les matériaux et analyses déjà produits."}
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
                : "Décrire le projet, ajouter des matériaux et lancer une analyse."}
            </p>
            <b>
              Commencer <i className="fa-solid fa-arrow-right" />
            </b>
          </button>
          <button
            className="cp-choice gate-archive"
            onClick={() => setIntent("resume")}
          >
            <span className="cp-gate-kicker">Archive</span>
            <span className="cp-icon" aria-hidden="true">
              <i className="fa-solid fa-book-open" />
            </span>
            <h3>
              {mode === "design" ? "Propositions faites" : "Reprendre"}
            </h3>
            <p>
              {mode === "design"
                ? hasProposals
                  ? `${topicArchive.length} sollicitation${topicArchive.length > 1 ? "s" : ""} : sujets proposés, choix, projet et plan.`
                  : emptyArchiveMessage()
                : resumeReady
                  ? "Consulter le brief, les matériaux et le schéma d’analyse."
                  : "Aucun matériau ni analyse n’est encore disponible."}
            </p>
            <b>
              {mode === "design"
                ? hasProposals
                  ? "Ouvrir l’archive"
                  : "Voir l’état"
                : resumeReady
                  ? "Consulter"
                  : "Voir l’état"}{" "}
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
                Chaque sollicitation conserve les trois sujets, le choix retenu
                le cas échéant, puis le projet et le plan générés.
              </p>
            </div>
            {topicArchive.map((entry, index) => {
              const pType = normalizeProjectType(entry.projectType);
              const chosenAxis = entry.chosenTopic?.axis;
              const open = proposalsOpen(entry.id, index);
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

                  {entry.chosenTopic ? (
                    <div className="topic-archive-block topic-archive-chosen-summary">
                      <strong>Sujet choisi</strong>
                      <div className="topic-archive-topic is-chosen">
                        <div className="topic-archive-topic-head">
                          <span
                            className="topic-archive-topic-title"
                            title={entry.chosenTopic.title}
                          >
                            {entry.chosenTopic.title}
                          </span>
                          <span className="topic-axis">
                            {AXIS_LABEL[entry.chosenTopic.axis] ||
                              entry.chosenTopic.axis}
                          </span>
                          <em className="topic-archive-chosen-tag">
                            Sujet choisi
                          </em>
                        </div>
                        {entry.chosenTopic.research_question ? (
                          <small
                            className="topic-archive-topic-q"
                            title={entry.chosenTopic.research_question}
                          >
                            {entry.chosenTopic.research_question}
                          </small>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="topic-archive-empty">
                      Aucun sujet n’a encore été retenu pour cette
                      sollicitation.
                    </p>
                  )}

                  {entry.documents?.length ? (
                    <div className="topic-archive-block">
                      <strong>Fichiers du sujet choisi</strong>
                      <p className="topic-archive-doc-hint">
                        Retéléchargez le projet et le plan tels qu’ils ont été
                        générés, sans nouvelle modification.
                      </p>
                      <div className="topic-doc-download">
                        {entry.documents.map((doc) => (
                          <a
                            key={doc.kind}
                            className="secondary"
                            href={"/api/workspace?file=" + doc.fileId}
                            download={doc.filename}
                          >
                            <i
                              className="fa-solid fa-download"
                              aria-hidden="true"
                            />{" "}
                            Retélécharger{" "}
                            {documentKindLabel(doc.kind, pType)} (Word)
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : entry.chosenTopic ? (
                    <p className="topic-archive-empty">
                      Projet / plan non archivés pour cette entrée.
                    </p>
                  ) : null}

                  <div className="topic-archive-block">
                    <button
                      type="button"
                      className="topic-archive-toggle"
                      aria-expanded={open}
                      onClick={() => toggleProposals(entry.id, index)}
                    >
                      <span>
                        Trois propositions
                        <small>
                          {open ? "Masquer" : "Afficher"} ·{" "}
                          {entry.topics.length} sujet
                          {entry.topics.length > 1 ? "s" : ""}
                        </small>
                      </span>
                      <i
                        className={
                          open
                            ? "fa-solid fa-chevron-up"
                            : "fa-solid fa-chevron-down"
                        }
                        aria-hidden="true"
                      />
                    </button>
                    <div
                      className={
                        open
                          ? "topic-archive-collapse is-open"
                          : "topic-archive-collapse"
                      }
                    >
                      <div className="topic-archive-collapse-inner">
                        <ul className="topic-archive-topics">
                          {entry.topics.map((t) => {
                            const isChosen = chosenAxis === t.axis;
                            return (
                              <li
                                key={t.axis}
                                className={
                                  isChosen
                                    ? "topic-archive-topic is-chosen"
                                    : "topic-archive-topic"
                                }
                              >
                                <div className="topic-archive-topic-head">
                                  <span
                                    className="topic-archive-topic-title"
                                    title={t.title}
                                  >
                                    {t.title}
                                  </span>
                                  <span className="topic-axis">
                                    {AXIS_LABEL[t.axis] || t.axis}
                                  </span>
                                  {isChosen ? (
                                    <em className="topic-archive-chosen-tag">
                                      Sujet choisi
                                    </em>
                                  ) : null}
                                </div>
                                {isChosen && t.research_question ? (
                                  <small
                                    className="topic-archive-topic-q"
                                    title={t.research_question}
                                  >
                                    {t.research_question}
                                  </small>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  </div>
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
            Reprendre · Organisation
            <small>
              {p.demo ? "Parcours d’exemple" : `${p.title}, ${p.type}`}
            </small>
          </p>
        </div>
        {!corpusReady ? (
          <section className="cp-card">
            <h3>Rien à consulter pour l’instant</h3>
            <p>
              Aucun brief, matériau ou schéma d’analyse n’est encore disponible
              sur ce projet.
            </p>
            <div className="cp-actions">
              <button className="primary" onClick={() => setIntent("start")}>
                Démarrer <i className="fa-solid fa-arrow-right" />
              </button>
            </div>
          </section>
        ) : (
          <>
            {(draft.brief || draft.briefName) && (
              <section className="cp-card">
                <div className="panelhead">
                  <h3>Brief du projet</h3>
                  <button
                    type="button"
                    className="textbtn"
                    onClick={() => setIntent("start")}
                  >
                    Modifier
                  </button>
                </div>
                {draft.briefName && <p>
                  <strong>{draft.briefName}</strong>
                </p>}
                {draft.brief && <p>{draft.brief}</p>}
                {draft.briefFile && (
                  <a href={"/api/workspace?file=" + draft.briefFile}>
                    Ouvrir le projet déposé
                  </a>
                )}
              </section>
            )}
            <section className="cp-card">
              <div className="panelhead">
                <h3>Matériaux</h3>
                <button type="button" className="textbtn" onClick={add}>
                  Ajouter
                </button>
              </div>
              {p.materials.length ? (
                p.materials.map((m: any) => (
                  <button
                    className="listrow"
                    key={m.id}
                    onClick={() => open(m)}
                  >
                    <i className="fa-solid fa-file-lines" aria-hidden="true" />
                    <span>
                      {m.title}
                      <small>
                        {materialCode(m)} · {m.type}
                      </small>
                    </span>
                    <span className="pill">
                      {materialText(m).trim()
                        ? "Texte disponible"
                        : "À documenter"}
                    </span>
                  </button>
                ))
              ) : (
                <p>Aucun matériau pour l’instant.</p>
              )}
            </section>
            {result ? (
              <section className="cp-card proposal">
                <small>
                  Proposition du {new Date(result.date).toLocaleString("fr-FR")}{" "}
                  · {result.model}
                </small>
                <h2>Schéma d’analyse</h2>
                {result.sections.map((s: any, i: number) => (
                  <article key={i}>
                    <h3>{s.title}</h3>
                    <p>{s.advice}</p>
                    {s.evidence.map((v: any, j: number) => {
                      const m = p.materials.find((x: any) => x.id === v.id);
                      return (
                        <blockquote key={j}>
                          « {v.quote} »
                          {m && (
                            <button
                              className="textbtn"
                              onClick={() => read({ m, quote: v.quote })}
                            >
                              {materialCode(m)} · {m.title}{" "}
                              <i className="fa-solid fa-up-right-from-square" />
                            </button>
                          )}
                        </blockquote>
                      );
                    })}
                  </article>
                ))}
                {result.gaps?.length > 0 && (
                  <>
                    <h3>Points à vérifier</h3>
                    <ul>
                      {result.gaps.map((g: string) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="cp-actions">
                  <button
                    className="secondary"
                    onClick={() => setIntent("start")}
                  >
                    Relancer une analyse
                  </button>
                </div>
              </section>
            ) : (
              <section className="cp-card">
                <h3>Pas encore de schéma d’analyse</h3>
                <p>
                  Les matériaux sont prêts à être croisés. Passez en mode
                  démarrage pour lancer une analyse.
                </p>
                <div className="cp-actions">
                  <button className="primary" onClick={() => setIntent("start")}>
                    Analyser <i className="fa-solid fa-arrow-right" />
                  </button>
                </div>
              </section>
            )}
          </>
        )}
        {reading && (
          <div className="overlay">
            <div
              className="dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Passage source"
            >
              <div className="dialoghead">
                <h2>{reading.m.title}</h2>
                <button onClick={() => read(null)}>Fermer</button>
              </div>
              <small>
                {materialCode(reading.m)} · {reading.m.source}
              </small>
              <SourcePassage
                text={materialText(reading.m)}
                quote={reading.quote}
              />
              {reading.m.file && (
                <a href={"/api/workspace?file=" + reading.m.file}>
                  Télécharger le fichier original
                </a>
              )}
            </div>
          </div>
        )}
      </section>
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
          onChooseTopic={async (topic, docs, sessionId) => {
            setFreshStart(false);
            await chooseTopic(topic, docs, sessionId);
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

  return (
    <section className="cp-flow topic-flow">
      <div className="topic-flow-bar">
        <button
          type="button"
          className="secondary topic-back"
          disabled={busy}
          onClick={() => setIntent("gate")}
        >
          <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Parcours
        </button>
        <p className="topic-flow-context">
          Organiser mon manuscrit
          <small>
            {p.demo ? "Nouveau parcours" : `${p.title}, ${p.type}`}
          </small>
        </p>
      </div>
      <section className="cp-card form-cp">
        <label>
          Décrivez votre projet de recherche
          <textarea
            rows={4}
            maxLength={30000}
            value={draft.brief || ""}
            placeholder="Question de départ, terrain, période et objectif du manuscrit…"
            onChange={(e) => update("brief", e.target.value)}
          />
        </label>
        <label className="import-cp">
          <i className="fa-solid fa-file-import" aria-hidden="true" />
          {draft.briefName || "Importer le texte d’un projet"}
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => importBrief(e.target.files?.[0])}
          />
        </label>
        {draft.briefFile && (
          <a href={"/api/workspace?file=" + draft.briefFile}>
            Ouvrir le projet déposé
          </a>
        )}
        <div className="panelhead">
          <h3>Matériaux du projet</h3>
          <button className="textbtn" onClick={add}>
            Ajouter un matériau
          </button>
        </div>
        {p.materials.length ? (
          <>
            <p>
              Choisissez les fiches à croiser dans cette analyse (120 000
              caractères par lot).
            </p>
            {p.materials.map((m: any) => (
              <div className="source-choice" key={m.id}>
                <input
                  aria-label={"Inclure " + m.title}
                  type="checkbox"
                  checked={!(draft.excluded || []).includes(m.id)}
                  onChange={(e) =>
                    update(
                      "excluded",
                      e.target.checked
                        ? (draft.excluded || []).filter(
                            (id: string) => id !== m.id,
                          )
                        : [...(draft.excluded || []), m.id],
                    )
                  }
                />
                <button className="listrow" onClick={() => open(m)}>
                  <i className="fa-solid fa-file-lines" aria-hidden="true" />
                  <span>
                    {m.title}
                    <small>
                      {materialCode(m)} · {m.type}
                    </small>
                  </span>
                  <span className="pill">
                    {materialText(m).trim()
                      ? "Texte disponible"
                      : "À documenter"}
                  </span>
                </button>
              </div>
            ))}
          </>
        ) : (
          <p>
            Ajoutez un premier entretien, une observation, une référence ou un
            tableau.
          </p>
        )}
      </section>
      {mode === "corpus" && (
        <section className="cp-card form-cp">
          <h3>Demander un schéma d’analyse</h3>
          <p>
            La proposition doit être remaniée par vos soins. Les références
            externes et les extraits du corpus sont présentés séparément.
          </p>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={external}
              onChange={(e) => search(e.target.checked)}
            />{" "}
            Rechercher aussi des références dans Crossref
          </label>
          {external && (
            <label>
              Mots-clés publics envoyés à Crossref
              <input
                maxLength={180}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ex. usages numériques étudiants"
              />
            </label>
          )}
          <Attestation analysis checked={consent} onChange={agree} />
          <div className="cp-actions">
            <button
              className="secondary"
              disabled={!consent || busy || !ready}
              onClick={() => persist(false)}
            >
              Enregistrer le cadrage
            </button>
            <button
              className="primary"
              disabled={
                !consent || busy || !ready || (external && !query.trim())
              }
              onClick={() => persist(true)}
            >
              {busy ? "Traitement en cours…" : "Analyser avec l’IA"}{" "}
              <i className="fa-solid fa-arrow-right" />
            </button>
          </div>
        </section>
      )}
      {mode === "corpus" && msg && (
        <p role="status" className="cp-message">
          {msg}
        </p>
      )}
      {mode === "corpus" && result && (
        <section className="cp-card proposal">
          <small>
            Proposition du {new Date(result.date).toLocaleString("fr-FR")} ·{" "}
            {result.model}
          </small>
          <h2>Schéma d’analyse</h2>
          {result.sections.map((s: any, i: number) => (
            <article key={i}>
              <h3>{s.title}</h3>
              <p>{s.advice}</p>
              {s.evidence.map((v: any, j: number) => {
                const m = p.materials.find((x: any) => x.id === v.id);
                return (
                  <blockquote key={j}>
                    « {v.quote} »
                    {m && (
                      <button
                        className="textbtn"
                        onClick={() => read({ m, quote: v.quote })}
                      >
                        {materialCode(m)} · {m.title}{" "}
                        <i className="fa-solid fa-up-right-from-square" />
                      </button>
                    )}
                  </blockquote>
                );
              })}
            </article>
          ))}
          {result.gaps.length > 0 && (
            <>
              <h3>Points à vérifier</h3>
              <ul>
                {result.gaps.map((g: string) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          )}
          <h3>Références externes repérées</h3>
          {result.references.length ? (
            result.references.map((r: any) => (
              <p key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
                {r.comparison && (
                  <span className="ref-comparison">
                    <b>{r.comparison.relation} à vérifier</b>
                    <br />
                    Résumé publié · « {r.comparison.passage} »<br />
                    Corpus · « {r.comparison.evidence.quote} »
                  </span>
                )}
              </p>
            ))
          ) : (
            <p>Aucune référence externe mobilisée.</p>
          )}
          <small>
            Empreinte {result.fingerprint} · {result.version}
          </small>
        </section>
      )}
      {reading && (
        <div className="overlay">
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Passage source"
          >
            <div className="dialoghead">
              <h2>{reading.m.title}</h2>
              <button onClick={() => read(null)}>Fermer</button>
            </div>
            <small>
              {materialCode(reading.m)} · {reading.m.source}
            </small>
            <SourcePassage
              text={materialText(reading.m)}
              quote={reading.quote}
            />
            {reading.m.file && (
              <a href={"/api/workspace?file=" + reading.m.file}>
                Télécharger le fichier original
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SourcePassage({ text, quote }: { text: string; quote: string }) {
  const index = text.indexOf(quote);
  return index < 0 ? (
    <p>La fiche a changé depuis cette analyse. Vérifiez la version citée.</p>
  ) : (
    <p className="source-passage">
      {text.slice(Math.max(0, index - 500), index)}
      <mark>{quote}</mark>
      {text.slice(index + quote.length, index + quote.length + 500)}
    </p>
  );
}
