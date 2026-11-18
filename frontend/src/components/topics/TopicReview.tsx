import { useState } from "react";
import {
  TOPIC_BLOCKS,
  topicQuestions,
} from "../../../../shared/research/topicQuestions";
import {
  isQuestionVisible,
  SKIP_VALUE,
} from "../../../../shared/research/topicTypes";
import QuestionField from "./QuestionField";
import { formatAnswer } from "./formatAnswer";
import { useConfirmDialog } from "./ConfirmDialog";

type Props = {
  answers: Record<string, unknown>;
  onAnswers: (answers: Record<string, unknown>) => void;
  onBack: () => void;
  onGenerate: () => void;
  onClear: () => void;
  busy: boolean;
  error: string;
  simulate: boolean;
  onSimulate: (value: boolean) => void;
};

export default function TopicReview({
  answers,
  onAnswers,
  onBack,
  onGenerate,
  onClear,
  busy,
  error,
  simulate,
  onSimulate,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  function setOne(id: string, value: unknown) {
    onAnswers({ ...answers, [id]: value });
  }

  function clearOne(id: string) {
    const next = { ...answers };
    delete next[id];
    onAnswers(next);
    if (editingId === id) setEditingId(null);
  }

  async function askDelete(id: string) {
    const ok = await confirm({
      title: "Supprimer cette réponse",
      message:
        "Supprimer uniquement cette réponse ? Cette action est définitive.",
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
      danger: true,
    });
    if (ok) clearOne(id);
  }

  return (
    <section className="topic-review topic-phase">
      {dialog}
      <div className="topic-progress" aria-label="Progression">
        <div className="topic-progress-bar">
          <i style={{ width: "100%" }} />
        </div>
        <p>Récapitulatif : vérifiez avant de valider</p>
      </div>

      <p className="topic-lead">
        Modifiez ou supprimez uniquement la partie concernée : le reste de vos
        réponses est conservé.
      </p>

      {TOPIC_BLOCKS.map((block) => {
        const qs = topicQuestions.filter(
          (q) => q.block === block.id && isQuestionVisible(q, answers),
        );
        const filled = qs.filter((q) => {
          const v = answers[q.id];
          return v !== undefined && v !== null && v !== "";
        });
        if (!filled.length && !block.required) return null;
        return (
          <section key={block.id} className="topic-review-block">
            <h3>{block.title}</h3>
            <ul className="topic-review-list">
              {qs.map((q) => {
                const raw = answers[q.id];
                const empty = raw === undefined || raw === null || raw === "";
                const text = empty ? "Non renseigné" : formatAnswer(q.id, raw);
                const isEditing = editingId === q.id;
                return (
                  <li key={q.id} className={isEditing ? "editing" : ""}>
                    <div className="topic-review-row">
                      <div>
                        <strong>{q.label}</strong>
                        {!isEditing && (
                          <p className={empty ? "topic-empty" : ""}>
                            {text || "—"}
                          </p>
                        )}
                      </div>
                      <div className="topic-review-actions">
                        {isEditing ? (
                          <button
                            type="button"
                            className="secondary topic-close"
                            onClick={() => setEditingId(null)}
                          >
                            Fermer
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setEditingId(q.id)}
                          >
                            Modifier
                          </button>
                        )}
                        {!empty && raw !== SKIP_VALUE && (
                          <button
                            type="button"
                            className="secondary topic-clear"
                            onClick={() => void askDelete(q.id)}
                          >
                            Supprimer
                          </button>
                        )}
                      </div>
                    </div>
                    {isEditing && (
                      <div className="topic-review-edit">
                        <QuestionField
                          question={q}
                          value={answers[q.id]}
                          onChange={(v) => setOne(q.id, v)}
                        />
                        <button
                          type="button"
                          className="primary topic-save-part"
                          onClick={() => setEditingId(null)}
                        >
                          Enregistrer cette partie
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {error && <p role="alert">{error}</p>}

      <label className="topic-simulate">
        <input
          type="checkbox"
          checked={simulate}
          disabled={busy}
          onChange={(e) => onSimulate(e.target.checked)}
        />
        <span>
          Mode simulation (sans IA)
          <small>
            Génère trois sujets d’exemple et des documents Word téléchargeables
            pour tester l’interface.
          </small>
        </span>
      </label>

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
          <button
            type="button"
            className="secondary"
            onClick={onBack}
            disabled={busy}
          >
            Retour
          </button>
          <button
            type="button"
            className="primary"
            onClick={onGenerate}
            disabled={busy}
          >
            {busy
              ? "Analyse…"
              : simulate
                ? "Simuler trois sujets"
                : "Valider et analyser"}
          </button>
        </div>
      </div>
    </section>
  );
}
