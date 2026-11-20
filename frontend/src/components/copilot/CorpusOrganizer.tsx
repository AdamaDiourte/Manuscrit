import { useEffect, useMemo, useState } from "react";
import { materialCode, materialText } from "../../../../shared/research/project";
import {
  BRIEF_MAX_CHARS,
  BRIEF_MIN_CHARS,
  CORPUS_STEPS,
  CORPUS_STEP_LABELS,
  DISCIPLINE_OPTIONS,
  DOCUMENT_TYPE_GROUPS,
  EXPECTED_LENGTH_OPTIONS,
  SPECIFIC_INSTRUCTIONS_MAX,
  WRITING_TIME_OPTIONS,
  canRequestWritingPlan,
  documentTypeLabel,
  expectedLengthLabel,
  writingTimeLabel,
  frameIsComplete,
  modesFromMaterials,
  noticesAccepted,
  projectIsReady,
  usableMaterials,
  type CorpusStep,
  disciplineLabel,
} from "../../../../shared/research/corpusOrganization";
import { estimateCorpusAnalysis } from "../../../../shared/research/estimateCorpus";
import {
  genreExpectationsSummary,
  genreProfileFor,
} from "../../../../shared/research/genreProfiles";
import TopicSelect from "../topics/TopicSelect";
import Attestation from "./Attestation";

type ProjectSummary = {
  id: string;
  title: string;
  type: string;
  typeOther?: string;
  demo?: boolean;
};

type Props = {
  p: any;
  projects: ProjectSummary[];
  draft: any;
  update: (key: string, value: any) => void;
  busy: boolean;
  ready: boolean;
  msg: string;
  consent: boolean;
  agree: (v: boolean) => void;
  external: boolean;
  search: (v: boolean) => void;
  simulatePlan: boolean;
  setSimulatePlan: (v: boolean) => void;
  query: string;
  setQuery: (v: string) => void;
  preferBatch: boolean;
  setPreferBatch: (v: boolean) => void;
  persist: (run: boolean) => Promise<boolean>;
  add: () => void;
  open: (m: any) => void;
  createProject: () => void;
  selectProject: (id: string) => void;
  onBack: () => void;
  goPrivacy: () => void;
  goTopics: () => void;
  onAbandon: () => void;
  onPlanReady: () => void | Promise<void>;
  /** Étape ciblée (ex. cadrage éditable, matériaux) — évite le récap plan. */
  initialStep?: CorpusStep | null;
};

function resolveStartStep(
  p: any,
  draft: any,
  preferred?: CorpusStep | null,
): CorpusStep {
  if (!projectIsReady(p, draft)) return "project";
  if (!noticesAccepted(draft)) return "notice";
  const usable = usableMaterials(p.materials || [], draft.excluded || []);
  if (preferred === "materials") return "materials";
  if (!usable.length) return "materials";
  if (preferred === "frame") return "frame";
  if (preferred === "plan" && frameIsComplete(draft)) return "plan";
  if (!frameIsComplete(draft)) return "frame";
  if (preferred === "plan") return "plan";
  return "plan";
}

export default function CorpusOrganizer({
  p,
  projects,
  draft,
  update,
  busy,
  ready,
  msg,
  consent,
  agree,
  external,
  search,
  simulatePlan,
  setSimulatePlan,
  query,
  setQuery,
  preferBatch,
  setPreferBatch,
  persist,
  add,
  open,
  createProject,
  selectProject,
  onBack,
  goPrivacy,
  goTopics,
  onAbandon,
  onPlanReady,
  initialStep = null,
}: Props) {
  const realProjects = projects.filter((x) => !x.demo);
  const [step, setStep] = useState<CorpusStep>(() =>
    resolveStartStep(p, draft, initialStep),
  );

  const excluded: string[] = draft.excluded || [];
  const declaredModes = useMemo(
    () => modesFromMaterials(p.materials || []),
    [p.materials],
  );
  const usable = useMemo(
    () => usableMaterials(p.materials || [], excluded),
    [p.materials, excluded],
  );
  const estimate = useMemo(
    () => estimateCorpusAnalysis(usable),
    [usable],
  );
  const [batchCapable, setBatchCapable] = useState(false);
  const [batchThreshold, setBatchThreshold] = useState(800);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/research/capabilities", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setBatchCapable(Boolean(data.batch));
        const n = Number(data.batchThreshold);
        if (Number.isFinite(n) && n > 0) setBatchThreshold(Math.floor(n));
      })
      .catch(() => {
        /* défaut : pas de mode lot */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const showBatchChoice =
    !simulatePlan && batchCapable && estimate.units > batchThreshold;
  useEffect(() => {
    if (!showBatchChoice && preferBatch) setPreferBatch(false);
  }, [showBatchChoice, preferBatch, setPreferBatch]);
  const researchQuestion = String(draft.researchQuestion || "").trim();
  const workingTitle = String(draft.workingTitle || "").trim();
  const hypothesesText = Array.isArray(draft.hypotheses)
    ? draft.hypotheses.join("\n")
    : String(draft.hypotheses || "");
  const hypothesesList = hypothesesText
    .split(/\n+/)
    .map((h: string) => h.trim())
    .filter(Boolean);
  const methodText = String(draft.method || "").trim();
  const fieldOrCorpusText = String(draft.fieldOrCorpus || "").trim();
  const projectOk = projectIsReady(p, draft);
  const noticeOk = noticesAccepted(draft);
  const frameOk = frameIsComplete(draft);
  const planOk = canRequestWritingPlan(
    draft,
    p.materials || [],
    excluded,
    p,
  );
  const stepIndex = CORPUS_STEPS.indexOf(step);

  function goStep(next: CorpusStep) {
    const target = CORPUS_STEPS.indexOf(next);
    if (target > CORPUS_STEPS.indexOf("project") && !projectOk) {
      setStep("project");
      return;
    }
    if (target > CORPUS_STEPS.indexOf("notice") && !noticeOk) {
      setStep("notice");
      return;
    }
    if (
      target >= CORPUS_STEPS.indexOf("frame") &&
      !usable.length
    ) {
      setStep("materials");
      return;
    }
    if (target >= CORPUS_STEPS.indexOf("plan") && !frameOk) {
      setStep("frame");
      return;
    }
    setStep(next);
  }

  return (
    <section className="cp-flow topic-flow">
      <div className="topic-flow-bar">
        <button
          type="button"
          className="secondary topic-back"
          disabled={busy}
          onClick={onBack}
        >
          <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Parcours
        </button>
        <p className="topic-flow-context">
          Organiser mon manuscrit
          <small>
            {p.demo
              ? "Aucun projet personnel sélectionné"
              : `${p.title}, ${p.type}`}
          </small>
        </p>
        <button
          type="button"
          className="secondary corpus-abandon"
          disabled={busy}
          onClick={onAbandon}
        >
          Abandonner
        </button>
      </div>

      <div className="cp-heading">
        <p className="step-label">
          Étape {stepIndex + 1} / {CORPUS_STEPS.length} ·{" "}
          {CORPUS_STEP_LABELS[step]}
        </p>
        <div className="step-meter" role="tablist" aria-label="Étapes">
          {CORPUS_STEPS.map((id, i) => (
            <button
              key={id}
              type="button"
              className={
                i === stepIndex ? "here" : i < stepIndex ? "done" : undefined
              }
              title={CORPUS_STEP_LABELS[id]}
              aria-label={CORPUS_STEP_LABELS[id]}
              aria-current={i === stepIndex ? "step" : undefined}
              onClick={() => goStep(id)}
            />
          ))}
        </div>
        <h2>{CORPUS_STEP_LABELS[step]}</h2>
        <p>
          {step === "project" &&
            "Créez ou choisissez un projet : toutes les données déposées et les propositions de l’IA y seront associées."}
          {step === "notice" &&
            "Avant tout dépôt : anonymisation, usage IA limité au plan de rédaction, et engagement de non-revente des données."}
          {step === "materials" &&
            "Sur chaque fiche : outil de recueil (fichier ou indisponible) et données recueillies (fichier obligatoire). Un code s’affiche à côté de l’intitulé pour le plan."}
          {step === "frame" &&
            "Précisez le type de support, la discipline, le volume et une présentation du sujet pour adapter le plan."}
          {step === "plan" &&
            "L’agent propose un plan de rédaction fondé uniquement sur vos matériaux. Il n’écrit pas le manuscrit à votre place."}
        </p>
      </div>

      {step === "project" && (
        <section className="cp-card form-cp corpus-project-step">
          <h3>Associer un projet</h3>
          <p>
            Les matériaux, le cadrage et le plan de rédaction seront enregistrés
            dans ce projet. Le parcours d’exemple ne peut pas accueillir vos
            données.
          </p>
          {p.demo && (
            <p className="cp-message" role="status">
              Vous êtes encore sur le projet d’exemple. Créez un projet ou
              sélectionnez-en un existant pour continuer.
            </p>
          )}
          <label className="field-select corpus-project-pick">
            Projet actif
            <TopicSelect
              value={p.demo ? "" : p.id}
              onChange={(id) => {
                if (id) selectProject(id);
              }}
              placeholder={
                realProjects.length
                  ? "Choisir un projet…"
                  : "Aucun projet — créez-en un"
              }
              allowEmpty={Boolean(p.demo) || !realProjects.length}
              disabled={!realProjects.length}
              options={realProjects.map((x) => ({
                value: x.id,
                label: `${x.title} · ${
                  x.type === "Autre" && x.typeOther
                    ? `Autre — ${x.typeOther}`
                    : x.type
                }`,
              }))}
              aria-label="Projet actif"
            />
          </label>
          <div className="corpus-project-actions">
            <button type="button" className="secondary" onClick={createProject}>
              <i className="fa-solid fa-plus" aria-hidden="true" /> Créer un
              projet
            </button>
          </div>
          {!p.demo && (
            <label className="inline-check">
              <input
                type="checkbox"
                checked={Boolean(draft.corpusProjectConfirmed)}
                onChange={(e) =>
                  update("corpusProjectConfirmed", e.target.checked)
                }
              />{" "}
              Je confirme que les matériaux et les productions de l’IA de ce
              parcours seront associés au projet « {p.title} ».
            </label>
          )}
          <div className="cp-actions">
            <span />
            <button
              type="button"
              className="primary"
              disabled={!projectOk}
              onClick={() => goStep("notice")}
            >
              Continuer <i className="fa-solid fa-arrow-right" />
            </button>
          </div>
        </section>
      )}

      {step === "notice" && (
        <section className="cp-card form-cp corpus-notice">
          <div className="topic-notice-box" style={{ marginBottom: 16 }}>
            <h3>Avant de télécharger vos matériaux</h3>
            <ul className="corpus-notice-list">
              <li>
                Assurez-vous que chaque document est <strong>anonyme</strong> ou{" "}
                <strong>pseudonymisé</strong>. Une pseudonymisation technique
                optionnelle (e-mails, téléphones, noms fournis) est disponible
                avant l’envoi à l’IA.
              </li>
              <li>
                Ces matériaux seront analysés par l’IA{" "}
                <strong>uniquement</strong> pour proposer un plan de rédaction
                ancré dans vos données, par <strong>unités</strong> (passages,
                tableaux, pages scannées).
              </li>
              <li>
                Les <strong>images</strong>, graphiques et PDF scannés peuvent
                être envoyés au fournisseur d’IA (vision) pour transcription ;
                toute citation issue d’une transcription automatique est
                signalée et à vérifier sur l’original.
              </li>
              <li>
                Au-delà de cet usage, l’application{" "}
                <strong>ne vend pas</strong> et{" "}
                <strong>ne partage pas</strong> vos matériaux à des tiers.
              </li>
              <li>
                L’IA n’écrit pas le manuscrit à votre place et n’invente pas de
                données absentes du corpus.
              </li>
            </ul>
            <button type="button" className="textbtn" onClick={goPrivacy}>
              Politique de confidentialité
            </button>
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(draft.corpusNoticeAccepted)}
              onChange={(e) =>
                update("corpusNoticeAccepted", e.target.checked)
              }
            />{" "}
            Je confirme que les documents que je vais déposer sont anonymes ou
            pseudonymisés, et que je dispose des droits nécessaires.
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(draft.corpusAiAccepted)}
              onChange={(e) => update("corpusAiAccepted", e.target.checked)}
            />{" "}
            Je comprends que mes matériaux seront analysés par l’IA pour
            proposer un plan de rédaction fondé sur ces données.
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(draft.corpusPrivacyAccepted)}
              onChange={(e) =>
                update("corpusPrivacyAccepted", e.target.checked)
              }
            />{" "}
            Je prends acte que, hors cette analyse, Manuscrit ne vend ni ne
            partage ces données à d’autres fins.
          </label>
          <div className="cp-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => goStep("project")}
            >
              Retour
            </button>
            <button
              type="button"
              className="primary"
              disabled={!noticeOk}
              onClick={() => goStep("materials")}
            >
              Continuer vers les matériaux{" "}
              <i className="fa-solid fa-arrow-right" />
            </button>
          </div>
        </section>
      )}

      {step === "materials" && (
        <section className="cp-card form-cp corpus-materials-step">
          <div className="panelhead corpus-materials-head">
            <h3>Matériaux référencés</h3>
            <button type="button" className="textbtn" onClick={add}>
              <i className="fa-solid fa-plus" aria-hidden="true" /> Ajouter un
              matériau
            </button>
          </div>

          <div className="corpus-modes-strip">
            <span className="corpus-modes-strip-label">
              Modes déduits des fiches
            </span>
            <div className="corpus-mode-chips">
              {declaredModes.map((label) => (
                <span className="corpus-mode-chip" key={label}>
                  {label}
                </span>
              ))}
              {!declaredModes.length && (
                <span className="corpus-mode-chip is-empty">
                  Aucune fiche pour l’instant
                </span>
              )}
            </div>
          </div>
          <p className="corpus-materials-hint">
            Deux champs, deux fichiers : l’outil peut être indisponible ; les
            données recueillies doivent être jointes. Code à côté de
            l’intitulé pour les citations.
          </p>

          {p.materials.length ? (
            <div className="corpus-materials-list">
              <p className="corpus-materials-list-lead">
                Cochez les fiches à inclure dans le prochain plan (120 000
                caractères par lot).
              </p>
              {p.materials.map((m: any) => {
                const hasText = Boolean(materialText(m).trim());
                const included = !excluded.includes(m.id);
                const code = materialCode(m);
                return (
                  <div
                    className={
                      included
                        ? "corpus-material-row is-included"
                        : "corpus-material-row"
                    }
                    key={m.id}
                  >
                    <input
                      aria-label={"Inclure " + m.title}
                      type="checkbox"
                      checked={included}
                      onChange={(e) =>
                        update(
                          "excluded",
                          e.target.checked
                            ? excluded.filter((id) => id !== m.id)
                            : [...excluded, m.id],
                        )
                      }
                    />
                    <button
                      type="button"
                      className="corpus-material-open"
                      onClick={() => open(m)}
                    >
                      <i
                        className="fa-solid fa-file-lines"
                        aria-hidden="true"
                      />
                      <span className="corpus-material-meta">
                        <strong>
                          <span className="material-code-badge">{code}</span>
                          {m.title || "Sans intitulé"}
                        </strong>
                        <small>
                          Outil :{" "}
                          {!m.toolType || m.toolType === "Aucun"
                            ? "Aucun"
                            : m.toolType}
                          {m.toolType &&
                          m.toolType !== "Aucun" &&
                          m.toolUnavailable
                            ? " (indisponible)"
                            : ""}
                          {" · "}
                          Données : {m.type || "—"}
                        </small>
                      </span>
                      <span
                        className={
                          hasText
                            ? "pill prog-done"
                            : "pill prog-none"
                        }
                      >
                        {hasText ? "Texte disponible" : "À documenter"}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="corpus-materials-empty">
              <p>
                Aucune fiche pour l’instant. Ajoutez l’outil (grille…) et les
                données recueillies à partir de cet outil (entretien
                réalisé…).
              </p>
              <button type="button" className="secondary" onClick={add}>
                <i className="fa-solid fa-plus" aria-hidden="true" /> Ajouter
                un matériau
              </button>
            </div>
          )}
          {!usable.length && p.materials.length > 0 && (
            <p className="cp-message" role="status">
              Aucune fiche sélectionnée ne contient encore de texte
              exploitable. Complétez l’observation ou joignez un document
              avant de continuer.
            </p>
          )}
          <div className="cp-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => goStep("notice")}
            >
              Retour
            </button>
            <button
              type="button"
              className="primary"
              disabled={!usable.length}
              onClick={() => goStep("frame")}
            >
              Continuer vers le cadrage{" "}
              <i className="fa-solid fa-arrow-right" />
            </button>
          </div>
        </section>
      )}

      {step === "frame" && (
        <section className="cp-card form-cp corpus-frame-step">
          <label className="field-select">
            Type de document visé <span className="req" aria-hidden="true">*</span>
            <TopicSelect
              value={draft.documentType || ""}
              onChange={(value) => {
                update("documentType", value);
                if (value !== "other") update("documentTypeOther", "");
              }}
              placeholder="Choisir…"
              allowEmpty
              groups={[...DOCUMENT_TYPE_GROUPS]}
              aria-label="Type de document visé (obligatoire)"
            />
          </label>
          {draft.documentType === "other" && (
            <label>
              Précisez le type de document{" "}
              <span className="req" aria-hidden="true">*</span>
              <input
                required
                maxLength={120}
                value={draft.documentTypeOther || ""}
                onChange={(e) => update("documentTypeOther", e.target.value)}
                placeholder="Ex. rapport de recherche, note de synthèse…"
              />
            </label>
          )}
          <label className="field-select">
            Discipline <span className="req" aria-hidden="true">*</span>
            <TopicSelect
              value={draft.discipline || ""}
              onChange={(value) => {
                update("discipline", value);
                if (value !== "autre") update("disciplineOther", "");
              }}
              placeholder="Choisir…"
              allowEmpty
              options={[...DISCIPLINE_OPTIONS]}
              aria-label="Discipline (obligatoire)"
            />
          </label>
          {draft.discipline === "autre" && (
            <label>
              Précisez la discipline{" "}
              <span className="req" aria-hidden="true">*</span>
              <input
                required
                maxLength={120}
                value={draft.disciplineOther || ""}
                onChange={(e) => update("disciplineOther", e.target.value)}
              />
            </label>
          )}
          <label>
            Spécialité ou sous-domaine (facultatif)
            <input
              maxLength={300}
              value={draft.specialty || ""}
              onChange={(e) => update("specialty", e.target.value)}
              placeholder="Ex. sociologie urbaine, histoire contemporaine…"
            />
          </label>
          <label className="field-select">
            Volume prévisionnel <span className="req" aria-hidden="true">*</span>
            <TopicSelect
              value={draft.expectedLength || ""}
              onChange={(value) => update("expectedLength", value)}
              placeholder="Choisir…"
              allowEmpty
              options={[...EXPECTED_LENGTH_OPTIONS]}
              aria-label="Volume prévisionnel (obligatoire)"
            />
          </label>
          <label className="field-select">
            Temps de rédaction disponible{" "}
            <span className="req" aria-hidden="true">*</span>
            <TopicSelect
              value={draft.writingTime || ""}
              onChange={(value) => update("writingTime", value)}
              placeholder="Choisir…"
              allowEmpty
              options={[...WRITING_TIME_OPTIONS]}
              aria-label="Temps de rédaction disponible (obligatoire)"
            />
            <span className="field-hint">
              Sert à proposer un planning de rédaction calé sur vos sections.
            </span>
          </label>
          <label>
            Date de démarrage (facultatif)
            <input
              type="date"
              value={draft.startDate || ""}
              onChange={(e) => update("startDate", e.target.value)}
              aria-label="Date de démarrage du planning (facultatif)"
            />
            <span className="field-hint">
              Laissez vide pour démarrer aujourd’hui. Si une échéance de rendu
              figure dans les dates du projet, elle sert de date de fin.
            </span>
          </label>
          <label>
            Présentation du sujet{" "}
            <span className="req" aria-hidden="true">*</span>
            <textarea
              rows={5}
              minLength={BRIEF_MIN_CHARS}
              maxLength={BRIEF_MAX_CHARS}
              value={draft.brief || ""}
              placeholder="Résumez votre objet, votre question de départ et ce que vous voulez démontrer ou comprendre."
              onChange={(e) => update("brief", e.target.value)}
              aria-describedby="brief-count"
            />
            <span
              id="brief-count"
              className={
                (draft.brief || "").trim().length > 0 &&
                ((draft.brief || "").trim().length < BRIEF_MIN_CHARS ||
                  (draft.brief || "").length > BRIEF_MAX_CHARS)
                  ? "field-count is-invalid"
                  : "field-count"
              }
            >
              {(draft.brief || "").length} / {BRIEF_MAX_CHARS} · minimum{" "}
              {BRIEF_MIN_CHARS} caractères
            </span>
          </label>
          <label>
            Question de recherche (facultatif)
            <textarea
              rows={3}
              maxLength={500}
              value={draft.researchQuestion || ""}
              placeholder="Formulez la question à laquelle votre manuscrit répond."
              onChange={(e) => update("researchQuestion", e.target.value)}
              aria-label="Question de recherche (facultatif)"
            />
            <span className="field-hint">
              {(draft.researchQuestion || "").length} / 500
            </span>
          </label>
          <fieldset className="corpus-optional-research">
            <legend>Précisions pour l’analyse (facultatif)</legend>
            <p className="field-hint">
              Ces éléments guident le plan de rédaction. Indépendants du parcours
              « Construire mon projet ».
            </p>
            <label>
              Titre de travail
              <input
                maxLength={220}
                value={draft.workingTitle || ""}
                onChange={(e) => update("workingTitle", e.target.value)}
                placeholder="Intitulé provisoire de votre manuscrit"
                aria-label="Titre de travail (facultatif)"
              />
            </label>
            <label>
              Hypothèses
              <textarea
                rows={4}
                maxLength={1500}
                value={hypothesesText}
                onChange={(e) => update("hypotheses", e.target.value)}
                placeholder={"Une hypothèse par ligne\nEx. Les usages varient selon le contexte institutionnel."}
                aria-label="Hypothèses (facultatif, une par ligne)"
              />
            </label>
            <label>
              Méthode
              <textarea
                rows={3}
                maxLength={800}
                value={draft.method || ""}
                onChange={(e) => update("method", e.target.value)}
                placeholder="Approche, outils ou protocole que vous mobilisez."
                aria-label="Méthode (facultatif)"
              />
            </label>
            <label>
              Terrain / corpus
              <textarea
                rows={3}
                maxLength={800}
                value={draft.fieldOrCorpus || ""}
                onChange={(e) => update("fieldOrCorpus", e.target.value)}
                placeholder="Public, lieux, archives ou corpus que vous analysez."
                aria-label="Terrain ou corpus (facultatif)"
              />
            </label>
            <label>
              Consignes spécifiques (établissement, directeur, revue, éditeur)
              <textarea
                rows={3}
                maxLength={SPECIFIC_INSTRUCTIONS_MAX}
                value={draft.specificInstructions || ""}
                onChange={(e) =>
                  update("specificInstructions", e.target.value)
                }
                placeholder="Ex. consignes du directeur, de la revue ou de l’éditeur…"
                aria-label="Consignes spécifiques (facultatif)"
              />
              <span className="field-hint">
                {(draft.specificInstructions || "").length} /{" "}
                {SPECIFIC_INSTRUCTIONS_MAX} · priment sur le profil générique du
                support
              </span>
            </label>
          </fieldset>
          {!frameOk && (
            <p className="cp-message" role="status">
              Renseignez les champs obligatoires (*) : type, discipline, volume,
              temps de rédaction et présentation du sujet ({BRIEF_MIN_CHARS} à{" "}
              {BRIEF_MAX_CHARS} caractères).
            </p>
          )}
          <div className="cp-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => goStep("materials")}
            >
              Retour
            </button>
            <button
              type="button"
              className="primary"
              disabled={!frameOk}
              onClick={() => goStep("plan")}
            >
              Continuer vers le plan{" "}
              <i className="fa-solid fa-arrow-right" />
            </button>
          </div>
        </section>
      )}

      {step === "plan" && (
        <>
          <section className="cp-card form-cp corpus-plan-step">
            <h3>Récapitulatif avant analyse</h3>
            <p className="corpus-plan-lead">
              Vérifiez ces éléments avant de demander le plan. Celui-ci suit une
              progression du simple au complexe, adaptée à votre support et à
              vos matériaux.
            </p>
            <dl className="corpus-recap">
              <div className="corpus-recap-row">
                <dt>Projet</dt>
                <dd>{p.title}</dd>
              </div>
              <div className="corpus-recap-row">
                <dt>Modes de recueil</dt>
                <dd>{declaredModes.join(" · ") || "Non renseigné"}</dd>
              </div>
              <div className="corpus-recap-row">
                <dt>Support</dt>
                <dd>
                  {documentTypeLabel(
                    draft.documentType,
                    draft.documentTypeOther,
                  )}
                </dd>
              </div>
              <div className="corpus-recap-row">
                <dt>Attentes du support</dt>
                <dd>
                  {genreExpectationsSummary(
                    genreProfileFor(draft.documentType),
                  )}
                </dd>
              </div>
              {(draft.specificInstructions || "").trim() && (
                <div className="corpus-recap-row">
                  <dt>Consignes spécifiques</dt>
                  <dd>{(draft.specificInstructions || "").trim()}</dd>
                </div>
              )}
              <div className="corpus-recap-row">
                <dt>Discipline</dt>
                <dd>
                  {disciplineLabel(draft.discipline, draft.disciplineOther)}
                  {draft.specialty ? ` · ${draft.specialty}` : ""}
                </dd>
              </div>
              <div className="corpus-recap-row">
                <dt>Volume</dt>
                <dd>{expectedLengthLabel(draft.expectedLength)}</dd>
              </div>
              <div className="corpus-recap-row">
                <dt>Temps de rédaction</dt>
                <dd>{writingTimeLabel(draft.writingTime) || "—"}</dd>
              </div>
              <div className="corpus-recap-row">
                <dt>Date de démarrage</dt>
                <dd>
                  {draft.startDate
                    ? new Date(draft.startDate + "T12:00:00").toLocaleDateString(
                        "fr-FR",
                      )
                    : "Aujourd’hui (par défaut)"}
                </dd>
              </div>
              <div className="corpus-recap-row">
                <dt>Matériaux retenus</dt>
                <dd>
                  {usable.length} fiche{usable.length > 1 ? "s" : ""} ·{" "}
                  {estimate.units.toLocaleString("fr-FR")} unité
                  {estimate.units > 1 ? "s" : ""} ·{" "}
                  {estimate.characters.toLocaleString("fr-FR")} caractères
                  {(estimate.scannedPages > 0 || estimate.imageUnits > 0) && (
                    <>
                      {" "}
                      (
                      {[
                        estimate.scannedPages > 0
                          ? `${estimate.scannedPages} page(s) scannée(s)`
                          : "",
                        estimate.imageUnits > 0
                          ? `${estimate.imageUnits} image(s)`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      )
                    </>
                  )}
                </dd>
              </div>
              {!simulatePlan && (
                <div className="corpus-recap-row">
                  <dt>Durée indicative</dt>
                  <dd>
                    {showBatchChoice && preferBatch
                      ? `~${estimate.durationBatchHours} h (mode économique)`
                      : `~${estimate.durationRealtimeMin} min (temps réel)`}
                    {showBatchChoice && (
                      <fieldset className="corpus-mode-radios">
                        <legend className="corpus-sr-only">Mode d’analyse</legend>
                        <label>
                          <input
                            type="radio"
                            name="corpus-analysis-mode"
                            checked={!preferBatch}
                            onChange={() => setPreferBatch(false)}
                          />{" "}
                          Temps réel
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="corpus-analysis-mode"
                            checked={preferBatch}
                            onChange={() => setPreferBatch(true)}
                          />{" "}
                          Économique : ≈ 50 % moins cher, résultat sous 24 h
                        </label>
                      </fieldset>
                    )}
                  </dd>
                </div>
              )}
              {workingTitle && (
                <div className="corpus-recap-row">
                  <dt>Titre de travail</dt>
                  <dd>{workingTitle}</dd>
                </div>
              )}
              {researchQuestion && (
                <div className="corpus-recap-row">
                  <dt>Question de recherche</dt>
                  <dd>{researchQuestion}</dd>
                </div>
              )}
              {hypothesesList.length > 0 && (
                <div className="corpus-recap-row">
                  <dt>Hypothèses</dt>
                  <dd>
                    <ul>
                      {hypothesesList.map((h: string, i: number) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {methodText && (
                <div className="corpus-recap-row">
                  <dt>Méthode</dt>
                  <dd>{methodText}</dd>
                </div>
              )}
              {fieldOrCorpusText && (
                <div className="corpus-recap-row">
                  <dt>Terrain / corpus</dt>
                  <dd>{fieldOrCorpusText}</dd>
                </div>
              )}
            </dl>
            {draft.brief && (
              <details className="corpus-plan-brief">
                <summary>Présentation du sujet</summary>
                <p>{draft.brief}</p>
              </details>
            )}
            <div className="corpus-plan-options">
              <label className="corpus-simulate">
                <input
                  type="checkbox"
                  checked={simulatePlan}
                  onChange={(e) => setSimulatePlan(e.target.checked)}
                />
                <span>
                  Aperçu simulé du plan
                  <small>
                    Montre un plan type à partir de votre cadrage et de vos
                    matériaux, sans appeler le service IA.
                  </small>
                </span>
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={external}
                  onChange={(e) => search(e.target.checked)}
                  disabled={simulatePlan}
                />{" "}
                Rechercher aussi des références scientifiques en ligne
                (mots-clés publics uniquement)
              </label>
              {external && !simulatePlan && (
                <label>
                  Mots-clés publics pour la recherche de références
                  <input
                    maxLength={180}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ex. usages numériques étudiants"
                  />
                </label>
              )}
            </div>
            <Attestation analysis checked={consent} onChange={agree} />
            <div className="cp-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => goStep("frame")}
              >
                Retour
              </button>
              <div className="cp-actions-right">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !ready || !planOk}
                  onClick={() => persist(false)}
                >
                  Enregistrer le cadrage
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    !consent ||
                    busy ||
                    !ready ||
                    !planOk ||
                    (!simulatePlan && external && !query.trim())
                  }
                  onClick={async () => {
                    const ok = await persist(true);
                    if (ok) onPlanReady();
                  }}
                >
                  {busy
                    ? simulatePlan
                      ? "Préparation de l’aperçu…"
                      : "Analyse en cours…"
                    : simulatePlan
                      ? "Voir l’aperçu du plan"
                      : "Lancer l’analyse"}{" "}
                  <i className="fa-solid fa-arrow-right" />
                </button>
              </div>
            </div>
            {!planOk && (
              <p className="cp-message" role="status">
                Complétez le projet, le consentement, au moins un matériau
                exploitable et le cadrage avant de demander un plan.
              </p>
            )}
          </section>
          {msg && (
            <p role="status" className="cp-message">
              {msg}
            </p>
          )}
        </>
      )}
    </section>
  );
}
