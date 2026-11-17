import type {
  GeneratedTopic,
  RegenReason,
  TopicAxis,
} from "../../../../shared/research/topicTypes";
import { REGEN_REASON_LABELS } from "../../../../shared/research/topicTypes";

const AXIS_LABEL: Record<TopicAxis, string> = {
  mastery: "Maîtrise",
  ambition: "Ambition",
  discovery: "Découverte",
};

type Props = {
  topics: GeneratedTopic[];
  regenerationsRemaining: number;
  model?: string;
  busy: boolean;
  error: string;
  onRegenerate: (axis: TopicAxis, reason: RegenReason) => void;
  onRestart: () => void;
  onChooseTopic?: (topic: GeneratedTopic) => void;
};

export default function TopicResults({
  topics,
  regenerationsRemaining,
  model,
  busy,
  error,
  onRegenerate,
  onRestart,
  onChooseTopic,
}: Props) {
  return (
    <section className="topic-results topic-phase">
      <header className="topic-section-head">
        <h2>Trois sujets proposés</h2>
        <p>
          Choisissez-en un pour poursuivre le cadrage.{" "}
          <span className="topic-ai-badge">Contenu généré par IA</span>
          {model ? <span className="topic-meta"> · {model}</span> : null}
          <br />
          <span className="topic-meta">
            Régénérations restantes : {regenerationsRemaining} / 3
          </span>
        </p>
      </header>

      {error && <p role="alert">{error}</p>}

      <div className="topic-cards">
        {topics.map((topic) => (
          <article key={topic.axis} className="topic-card panel">
            <header className="panelhead">
              <h2>
                <span className="topic-axis">{AXIS_LABEL[topic.axis]}</span>
                {topic.title}
              </h2>
            </header>
            <p>
              <strong>Question de recherche.</strong> {topic.research_question}
            </p>
            <p>
              <strong>Hypothèses.</strong>
            </p>
            <ul>
              {topic.hypotheses.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
            <p>
              <strong>Terrain / corpus.</strong> {topic.field_or_corpus}
            </p>
            <p>
              <strong>Méthode.</strong> {topic.method}
            </p>
            <p>
              <strong>Faisabilité ({topic.feasibility.level}).</strong>{" "}
              Risques : {topic.feasibility.risks.join(" ; ") || "—"}. Premiers
              pas : {topic.feasibility.first_steps.join(" ; ")}.
            </p>
            <p>
              <strong>Lien avec votre profil.</strong> {topic.rationale}
            </p>
            <p>
              <strong>Mots-clés FR.</strong> {topic.keywords_fr.join(", ")}
            </p>
            <p>
              <strong>Mots-clés EN.</strong> {topic.keywords_en.join(", ")}
            </p>
            {topic.ethical_notes && (
              <p>
                <strong>Notes éthiques / RGPD projet.</strong>{" "}
                {topic.ethical_notes}
              </p>
            )}

            <div className="topic-card-actions">
              {onChooseTopic && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => onChooseTopic(topic)}
                >
                  Choisir ce sujet
                </button>
              )}
              <label className="topic-regen">
                Régénérer ce sujet
                <select
                  id={"regen-" + topic.axis}
                  defaultValue=""
                  disabled={busy || regenerationsRemaining <= 0}
                  onChange={(e) => {
                    const reason = e.target.value as RegenReason;
                    if (!reason) return;
                    onRegenerate(topic.axis, reason);
                    e.target.value = "";
                  }}
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
              </label>
            </div>
          </article>
        ))}
      </div>

      <div className="topic-nav">
        <button type="button" className="secondary" onClick={onRestart} disabled={busy}>
          Nouveau questionnaire
        </button>
      </div>
    </section>
  );
}
