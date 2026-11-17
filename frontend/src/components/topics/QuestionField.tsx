import type { Question } from "../../../../shared/research/topicTypes";
import { SKIP_VALUE } from "../../../../shared/research/topicTypes";
import { TEXT_WARNING, SKIP_LABEL } from "../../../../shared/research/topicQuestions";
import {
  detectSensitiveTerms,
  maskIdentifiers,
} from "../../../../shared/privacy/sensitiveFilter";
import { useConfirmDialog } from "./ConfirmDialog";

type Props = {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
};

export default function QuestionField({ question, value, onChange }: Props) {
  const skipped = value === SKIP_VALUE;
  const textValue = typeof value === "string" && value !== SKIP_VALUE ? value : "";
  const sensitive =
    question.type === "text_short" && textValue
      ? detectSensitiveTerms(textValue)
      : [];

  function setText(raw: string) {
    const masked = maskIdentifiers(raw).text;
    onChange(masked.slice(0, question.maxLength ?? 300));
  }

  function skipToggle(checked: boolean) {
    onChange(
      checked
        ? SKIP_VALUE
        : question.type === "multi" || question.type === "multi_scale"
          ? []
          : "",
    );
  }

  return (
    <fieldset className="topic-field" data-risk={question.sensitiveRisk}>
      <legend className="topic-sr-only">
        {question.label}
        {question.required ? " (obligatoire)" : ""}
      </legend>
      <div className="topic-field-head">
        <h3 className="topic-field-title">
          {question.label}
          {question.required ? " *" : ""}
        </h3>
        {question.help ? (
          <p className="topic-field-sub">{question.help}</p>
        ) : null}
      </div>

      {question.allowSkip && !question.required && (
        <label className="topic-skip">
          <input
            type="checkbox"
            checked={skipped}
            onChange={(e) => skipToggle(e.target.checked)}
          />
          <span>{SKIP_LABEL}</span>
        </label>
      )}

      <div
        className={
          skipped ? "topic-field-body is-collapsed" : "topic-field-body"
        }
        aria-hidden={skipped}
      >
        {question.type === "single" && (
          <div className="topic-options">
            {(question.options || []).map((opt) => (
              <label key={opt.value} className="topic-option">
                <input
                  type="radio"
                  name={question.id}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={() => onChange(opt.value)}
                  tabIndex={skipped ? -1 : undefined}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        )}

        {question.type === "multi" && (
          <div className="topic-options">
            {(question.options || []).map((opt) => {
              const arr = Array.isArray(value) ? (value as string[]) : [];
              const checked = arr.includes(opt.value);
              return (
                <label key={opt.value} className="topic-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    tabIndex={skipped ? -1 : undefined}
                    onChange={() =>
                      onChange(
                        checked
                          ? arr.filter((v) => v !== opt.value)
                          : [...arr, opt.value],
                      )
                    }
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
        )}

        {question.type === "text_short" && (
          <div className="topic-text-block">
            <textarea
              rows={3}
              maxLength={question.maxLength ?? 300}
              value={textValue}
              onChange={(e) => setText(e.target.value)}
              aria-describedby={question.id + "-warn"}
              placeholder="Saisissez votre réponse…"
              tabIndex={skipped ? -1 : undefined}
            />
            <small id={question.id + "-warn"} className="topic-warn">
              {question.sensitiveRisk === "medium"
                ? "Avertissement renforcé : " + TEXT_WARNING
                : TEXT_WARNING}
            </small>
            <small className="topic-count">
              {textValue.length}/{question.maxLength ?? 300}
            </small>
            {sensitive.length > 0 && (
              <p className="topic-sensitive" role="status">
                Ce texte semble contenir une information sensible (
                {sensitive
                  .map((h) => h.category)
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(", ")}
                ). Souhaitez-vous la retirer ?
              </p>
            )}
          </div>
        )}

        {question.type === "multi_scale" && (
          <div className="topic-scales">
            {(question.options || []).map((opt) => {
              const map =
                value && typeof value === "object" && !Array.isArray(value)
                  ? (value as Record<string, number>)
                  : {};
              const current = map[opt.value];
              return (
                <label key={opt.value} className="topic-scale-row">
                  <span>{opt.label}</span>
                  <select
                    value={current === undefined ? "" : String(current)}
                    tabIndex={skipped ? -1 : undefined}
                    onChange={(e) => {
                      const next = { ...map };
                      if (e.target.value === "") delete next[opt.value];
                      else next[opt.value] = Number(e.target.value);
                      onChange(next);
                    }}
                  >
                    <option value="">Choisir</option>
                    {Array.from(
                      {
                        length:
                          (question.max ?? 3) - (question.min ?? 0) + 1,
                      },
                      (_, i) => (question.min ?? 0) + i,
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "aucune" : n}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        )}

        {question.type === "repeatable_group" && (
          <RepeatableGroup
            question={question}
            value={
              Array.isArray(value) ? (value as Record<string, string>[]) : []
            }
            onChange={onChange}
          />
        )}
      </div>
    </fieldset>
  );
}

function RepeatableGroup({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: Record<string, string>[];
  onChange: (v: unknown) => void;
}) {
  const fields = question.fields || [];
  const { confirm, dialog } = useConfirmDialog();

  function update(index: number, fieldId: string, v: string) {
    const next = value.map((row, i) =>
      i === index ? { ...row, [fieldId]: v } : row,
    );
    onChange(next);
  }

  async function askDeleteOne(index: number) {
    const ok = await confirm({
      title: "Supprimer ce travail",
      message:
        "Supprimer ce travail antérieur ? Cette action est définitive.",
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
      danger: true,
    });
    if (ok) onChange(value.filter((_, i) => i !== index));
  }

  async function askDeleteAll() {
    const ok = await confirm({
      title: "Supprimer tous les travaux",
      message: "Supprimer tous les travaux antérieurs saisis ?",
      confirmLabel: "Tout supprimer",
      cancelLabel: "Annuler",
      danger: true,
    });
    if (ok) onChange([]);
  }

  return (
    <div className="topic-repeat">
      {dialog}
      {value.map((row, index) => (
        <div key={index} className="topic-repeat-row">
          <div className="topic-repeat-head">
            <strong>Travail {index + 1}</strong>
            <button
              type="button"
              className="secondary topic-delete"
              onClick={() => void askDeleteOne(index)}
            >
              Supprimer
            </button>
          </div>
          {fields.map((f) =>
            f.type === "single" ? (
              <label key={f.id}>
                {f.label}
                <select
                  value={row[f.id] || ""}
                  onChange={(e) => update(index, f.id, e.target.value)}
                >
                  <option value="">Choisir</option>
                  {(f.options || []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label key={f.id}>
                {f.label}
                <input
                  maxLength={f.maxLength ?? 300}
                  value={row[f.id] || ""}
                  onChange={(e) =>
                    update(
                      index,
                      f.id,
                      maskIdentifiers(e.target.value).text.slice(
                        0,
                        f.maxLength ?? 300,
                      ),
                    )
                  }
                />
              </label>
            ),
          )}
        </div>
      ))}
      <div className="topic-repeat-actions">
        <button
          type="button"
          className="secondary topic-add-entry"
          onClick={() => onChange([...value, {}])}
          disabled={value.length >= 5}
        >
          + Ajouter une entrée
        </button>
        {value.length > 0 && (
          <button
            type="button"
            className="secondary topic-clear"
            onClick={() => void askDeleteAll()}
          >
            Supprimer tous les travaux
          </button>
        )}
      </div>
      <small className="topic-warn">{TEXT_WARNING}</small>
    </div>
  );
}
