import { topicQuestions } from "../../../../shared/research/topicQuestions";
import QuestionField from "./QuestionField";

type Props = {
  answers: Record<string, unknown>;
  onAnswers: (answers: Record<string, unknown>) => void;
  onContinue: () => void;
  onSkip: () => void;
  busy: boolean;
  error: string;
};

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

export default function TopicEnrich({
  answers,
  onAnswers,
  onContinue,
  onSkip,
  busy,
  error,
}: Props) {
  const interestFilled = isFilled(answers.interest_objects);
  const curiousFilled = isFilled(answers.curious_discipline);
  const useMethods = interestFilled && curiousFilled;

  const fieldIds = useMethods
    ? (["methods_skills"] as const)
    : (["interest_objects", "curious_discipline"] as const);

  const questions = fieldIds
    .map((id) => topicQuestions.find((q) => q.id === id))
    .filter(Boolean);

  return (
    <section className="topic-phase topic-enrich">
      <div className="topic-section-head">
        <h2>Pour des sujets vraiment adaptés</h2>
        <p>Répondez à 2 questions (30 secondes).</p>
      </div>

      {error ? <p role="alert">{error}</p> : null}

      <div className="topic-enrich-fields">
        {questions.map((q) =>
          q ? (
            <QuestionField
              key={q.id}
              question={q}
              value={answers[q.id]}
              onChange={(value) =>
                onAnswers({ ...answers, [q.id]: value })
              }
            />
          ) : null,
        )}
      </div>

      <div className="topic-nav topic-enrich-actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={onContinue}
        >
          Continuer
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onSkip}
        >
          Générer quand même
        </button>
      </div>
    </section>
  );
}
