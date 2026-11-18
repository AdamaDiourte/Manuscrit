import { useEffect, useRef, useState } from "react";
import {
  TOPIC_BLOCKS,
  topicQuestions,
} from "../../../../shared/research/topicQuestions";
import {
  isQuestionVisible,
  SKIP_VALUE,
} from "../../../../shared/research/topicTypes";
import QuestionField from "./QuestionField";
import AnimatedReveal from "./AnimatedReveal";

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

const EXIT_MS = 280;

function isAnswerEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (value === SKIP_VALUE) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

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
  const blockQuestions = topicQuestions.filter((q) => q.block === block.id);
  const visibleQuestions = blockQuestions.filter((q) =>
    isQuestionVisible(q, answers),
  );
  const [missingIds, setMissingIds] = useState<string[]>([]);
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    setMissingIds([]);
  }, [step]);

  function setAnswer(id: string, value: unknown) {
    const next = { ...answers, [id]: value };
    const otherId = OTHER_CLEAR[id];
    const clearingOther =
      !!otherId && value !== OTHER_VALUE[id] && answers[otherId] !== undefined;

    onAnswers(next);
    if (!isAnswerEmpty(value)) {
      setMissingIds((ids) => ids.filter((x) => x !== id));
    }
    if (clearingOther && otherId) {
      window.setTimeout(() => {
        const current = { ...answersRef.current };
        if (current[id] !== OTHER_VALUE[id]) {
          delete current[otherId];
          onAnswers(current);
        }
      }, EXIT_MS);
    }
  }

  function missingRequiredIds(): string[] {
    return visibleQuestions
      .filter((q) => q.required && isAnswerEmpty(answers[q.id]))
      .map((q) => q.id);
  }

  function next() {
    const missing = missingRequiredIds();
    if (missing.length) {
      setMissingIds(missing);
      window.requestAnimationFrame(() => {
        document
          .getElementById("topic-field-" + missing[0])
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    setMissingIds([]);
    if (step < total) onStep(step + 1);
    else onReview();
  }

  function goStep(n: number) {
    setMissingIds([]);
    onStep(n);
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

      <div className="topic-section-head">
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
      </div>

      {missingIds.length > 0 && (
        <p className="topic-form-error" role="alert">
          Complétez les champs obligatoires indiqués en rouge
          {missingIds.length > 1 ? ` (${missingIds.length})` : ""}.
        </p>
      )}

      <form
        className="topic-form"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
        noValidate
      >
        {blockQuestions.map((q) => {
          const show = isQuestionVisible(q, answers);
          return (
            <AnimatedReveal key={q.id} show={show} durationMs={EXIT_MS}>
              <QuestionField
                question={q}
                value={answers[q.id]}
                invalid={missingIds.includes(q.id)}
                onChange={(v) => setAnswer(q.id, v)}
              />
            </AnimatedReveal>
          );
        })}

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
                onClick={() => goStep(step - 1)}
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
