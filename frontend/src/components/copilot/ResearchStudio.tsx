import { useState } from "react";
import {
  questions,
  materialCode,
  materialText,
} from "../../../../shared/research/project";
import type { GeneratedTopic } from "../../../../shared/research/topicTypes";
import Attestation from "./Attestation";
import TopicGenerator from "../topics/TopicGenerator";

export type ResearchPage =
  | "Accueil"
  | "Construire mon projet"
  | "Organiser mon manuscrit"
  | "Continuer un projet";

type Mode = "design" | "corpus";

type Props = {
  page: ResearchPage;
  p: any;
  projects: any[];
  ready: boolean;
  save: (draft: any) => Promise<void>;
  add: () => void;
  open: (m: any) => void;
  project: () => void;
  go: (page: string) => void;
  continueProject: (id: string) => void;
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

export default function ResearchStudio({
  page,
  p,
  projects,
  ready,
  save,
  add,
  open,
  project,
  go,
  continueProject,
}: Props) {
  const mode = modeOf(page);
  const [projectFile, setProjectFile] = useState<File | null>(null);
  const [draft, set] = useState<any>(p.copilot || {}),
    [step, jump] = useState(0),
    [consent, agree] = useState(false),
    [external, search] = useState(false),
    [query, setQuery] = useState(""),
    [busy, wait] = useState(false),
    [msg, notice] = useState(""),
    [reading, read] = useState<any>(null);
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
  const started = projects.filter((x: any) => !x.demo);
  const result = mode ? draft[mode + "Result"] : null;

  if (page === "Accueil")
    return (
      <div className="cp-home">
        <div className="cp-heading">
          <h2>Accueil</h2>
          <p>
            Cadrez votre sujet, organisez votre manuscrit, ou poursuivez un
            travail déjà engagé.
          </p>
        </div>
        <div className="cp-choices">
          <button
            className="cp-choice design"
            onClick={() => go("Construire mon projet")}
          >
            <span className="cp-icon" aria-hidden="true">
              <i className="fa-solid fa-pen-to-square" />
            </span>
            <h3>Construire mon projet</h3>
            <p>
              Choisir un sujet parmi trois propositions, puis cadrer la question
              de recherche, le terrain et la méthode.
            </p>
            <b>
              Choisir un sujet <i className="fa-solid fa-arrow-right" />
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
              Travailler sur mon corpus{" "}
              <i className="fa-solid fa-arrow-right" />
            </b>
          </button>
          <button
            className="cp-choice continue"
            onClick={() => go("Continuer un projet")}
          >
            <span className="cp-icon" aria-hidden="true">
              <i className="fa-solid fa-book" />
            </span>
            <h3>Continuer un projet</h3>
            <p>
              Reprendre un manuscrit déjà commencé : tableau de bord, matériaux
              et rédaction.
            </p>
            <b>
              Voir mes projets <i className="fa-solid fa-arrow-right" />
            </b>
          </button>
        </div>
        <div className="cp-note">
          <i className="fa-solid fa-circle-info" aria-hidden="true" />
          <span>
            Vous restez l’auteur de la recherche. Chaque proposition est une
            base à discuter, à reconstruire et à justifier.
          </span>
        </div>
        <button className="textbtn" onClick={project}>
          Créer un nouveau projet <i className="fa-solid fa-arrow-right" />
        </button>
      </div>
    );

  if (page === "Continuer un projet")
    return (
      <section className="cp-flow topic-flow">
        <div className="topic-flow-bar">
          <button type="button" className="secondary topic-back" onClick={() => go("Accueil")}>
            <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Accueil
          </button>
        </div>
        <div className="cp-heading">
          <h2>Continuer un projet</h2>
          <p>Sélectionnez un projet entamé pour reprendre le travail.</p>
        </div>
        <section className="cp-card">
          {started.length ? (
            <div className="cp-project-list">
              {started.map((x: any) => (
                <button
                  className="listrow"
                  key={x.id}
                  onClick={() => continueProject(x.id)}
                >
                  <i className="fa-solid fa-book-open" aria-hidden="true" />
                  <span>
                    {x.title}
                    <small>
                      {[x.type, x.person, `${x.chapters?.length || 0} chapitres`]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <i className="fa-solid fa-chevron-right" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <p>
              Aucun projet personnel n’a encore été commencé. Créez un projet
              ou démarrez par la construction du sujet.
            </p>
          )}
          <div className="cp-actions">
            <button
              className="secondary"
              onClick={() => go("Construire mon projet")}
            >
              Construire mon projet
            </button>
            <button className="primary" onClick={project}>
              <i className="fa-solid fa-plus" /> Nouveau projet
            </button>
          </div>
        </section>
      </section>
    );

  async function chooseTopic(topic: GeneratedTopic) {
    const next = { ...draft, ...draftFromTopic(topic) };
    set(next);
    try {
      await save(next);
      notice("Sujet retenu. Poursuivez le cadrage du projet.");
    } catch {
      notice("Sujet retenu localement. Enregistrement du projet à confirmer.");
    }
  }

  if (mode === "design" && !draft.chosenTopic) {
    return (
      <section className="cp-flow topic-flow">
        <div className="topic-flow-bar">
          <button type="button" className="secondary topic-back" onClick={() => go("Accueil")}>
            <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Accueil
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
          onChooseTopic={chooseTopic}
        />
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
          onClick={() => go("Accueil")}
        >
          <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Accueil
        </button>
        <p className="topic-flow-context">
          {mode === "design" ? "Étape 2 : Cadrer le projet" : "Organiser mon manuscrit"}
          <small>
            {p.demo ? "Nouveau parcours" : `${p.title}, ${p.type}`}
          </small>
        </p>
      </div>
      {mode === "design" && draft.chosenTopic && (
        <section className="cp-card topic-chosen">
          <div className="panelhead">
            <h3>Sujet retenu</h3>
            <button
              type="button"
              className="textbtn"
              disabled={busy}
              onClick={() => {
                const next = { ...draft };
                delete next.chosenTopic;
                set(next);
                void save(next);
              }}
            >
              Changer de sujet
            </button>
          </div>
          <p>
            <strong>{draft.chosenTopic.title}</strong>
            <small>{draft.chosenTopic.research_question}</small>
          </p>
        </section>
      )}
      <section className="cp-card form-cp">
        {mode === "design" ? (
          <>
            <div className="step-label">
              Question {step + 1} sur {questions.length}
            </div>
            <div className="step-meter">
              {questions.map(([k, q], i) => (
                <button
                  title={q}
                  aria-label={q}
                  className={i === step ? "here" : draft[k] ? "done" : ""}
                  key={k}
                  onClick={() => jump(i)}
                />
              ))}
            </div>
            <label>
              {questions[step][1]}
              <textarea
                maxLength={4500}
                rows={4}
                value={draft[questions[step][0]] || ""}
                placeholder={questions[step][2]}
                onChange={(e) => update(questions[step][0], e.target.value)}
              />
            </label>
            <div className="cp-actions">
              <button
                className="secondary"
                disabled={step === 0}
                onClick={() => jump(step - 1)}
              >
                Précédent
              </button>
              {step < questions.length - 1 && (
                <button className="primary" onClick={() => jump(step + 1)}>
                  Continuer <i className="fa-solid fa-arrow-right" />
                </button>
              )}
            </div>
          </>
        ) : (
          <>
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
                Ajoutez un premier entretien, une observation, une référence ou
                un tableau.
              </p>
            )}
          </>
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
                const m = p.materials.find((m: any) => m.id === v.id);
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
