import {
  TOPIC_BLOCKS,
  topicQuestions,
} from "../../../../shared/research/topicQuestions";
import { isQuestionVisible } from "../../../../shared/research/topicTypes";
import QuestionField from "./QuestionField";

type Props = {
  step: number;
  answers: Record<string, unknown>;
  onAnswers: (answers: Record<string, unknown>) => void;
  onStep: (step: number) => void;
  onClear: () => void;
  onReview: () => void;
  busy: boolean;
  error: string;
};

const OTHER_CLEAR: Record<string, string> = {
  project_type: "project_type_other",
  discipline_main: "discipline_main_other",
  writing_language: "writing_language_other",
};

const OTHER_VALUE: Record<string, string> = {
  project_type: "other",
  discipline_main: "autre",
  writing_language: "other",
};

export default function TopicQuestionnaire({
  step,
  answers,
  onAnswers,
  onStep,
  onClear,
  onReview,
  busy,
  error,
}: Props) {
  const total = TOPIC_BLOCKS.length;
  const block = TOPIC_BLOCKS[step - 1];
  const questions = topicQuestions.filter(
    (q) => q.block === block.id && isQuestionVisible(q, answers),
  );

  function setAnswer(id: string, value: unknown) {
    const next = { ...answers, [id]: value };
    const otherId = OTHER_CLEAR[id];
    if (otherId && value !== OTHER_VALUE[id]) delete next[otherId];
    onAnswers(next);
  }

  function validateBlock1(): string | null {
    if (block.id !== 1) return null;
    for (const q of questions) {
      if (!q.required) continue;
      const v = answers[q.id];
      if (v === undefined || v === null || v === "")
        return "Complétez les champs obligatoires du cadre du projet.";
    }
    return null;
  }

  function next() {
    const err = validateBlock1();
    if (err) {
      alert(err);
      return;
    }
    if (step < total) onStep(step + 1);
    else onReview();
  }

  return (
    <section className="topic-quiz topic-phase">
      <div className="topic-progress" aria-label="Progression">
        <div className="topic-progress-bar">
          <i style={{ width: (step / (total + 1)) * 100 + "%" }} />
        </div>
        <p>
          Questionnaire {step}/{total} : {block.title}
          {!block.required ? " (facultatif)" : ""}, puis récapitulatif
        </p>
      </div>

      <header className="topic-section-head">
        <h2>{block.title}</h2>
        <p
          className={
            block.required
              ? "topic-block-flag is-required"
              : "topic-block-flag is-optional"
          }
        >
          {block.required
            ? "Bloc obligatoire pour proposer des sujets réalistes."
            : "Facultatif : vous pouvez passer ou répondre partiellement."}
        </p>
      </header>

      <form
        className="topic-form"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        {questions.map((q) => (
          <div key={q.id} className="topic-field-enter">
            <QuestionField
              question={q}
              value={answers[q.id]}
              onChange={(v) => setAnswer(q.id, v)}
            />
          </div>
        ))}

        {error && <p role="alert">{error}</p>}

        <div className="topic-nav">
          <button
            type="button"
            className="secondary topic-clear"
            onClick={onClear}
            disabled={busy}
          >
            Effacer mes réponses
          </button>
          <div className="topic-nav-right">
            {step > 1 && (
              <button
                type="button"
                className="secondary"
                onClick={() => onStep(step - 1)}
                disabled={busy}
              >
                Précédent
              </button>
            )}
            <button type="submit" className="primary" disabled={busy}>
              {step < total ? "Suivant" : "Voir le récapitulatif"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
