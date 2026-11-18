import type { Question } from "../../../../shared/research/topicTypes";
import { SKIP_VALUE } from "../../../../shared/research/topicTypes";
import { TEXT_WARNING, SKIP_LABEL } from "../../../../shared/research/topicQuestions";
import {
  detectSensitiveTerms,
  maskIdentifiers,
} from "../../../../shared/privacy/sensitiveFilter";
import { useConfirmDialog } from "./ConfirmDialog";
import TopicSelect from "./TopicSelect";
import TopicMultiSelect from "./TopicMultiSelect";

type Props = {
  question: Question;
  value: unknown;
  invalid?: boolean;
  onChange: (value: unknown) => void;
};

function isFieldComplete(value: unknown): boolean {
  if (value === SKIP_VALUE) return true;
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    if (typeof value[0] === "object") {
      return value.some((row) =>
        Object.values(row as Record<string, string>).some((v) =>
          Boolean(String(v || "").trim()),
        ),
      );
    }
    return true;
  }
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

export default function QuestionField({
  question,
  value,
  invalid = false,
  onChange,
}: Props) {
  const skipped = value === SKIP_VALUE;
  const complete = !invalid && isFieldComplete(value);
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

  const fieldClass = [
    "topic-field",
    invalid ? "is-invalid" : "",
    complete ? "is-complete" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset
      id={"topic-field-" + question.id}
      className={fieldClass}
      data-risk={question.sensitiveRisk}
      aria-invalid={invalid || undefined}
    >
      <legend className="topic-sr-only">
        {question.label}
        {question.required ? " (obligatoire)" : ""}
      </legend>
      <div className="topic-field-head">
        <div className="topic-field-title-row">
          <h3 className="topic-field-title">
            {question.label}
            {question.required ? (
              <span className="topic-required-mark" aria-hidden="true">
                {" "}
                *
              </span>
            ) : null}
          </h3>
          {complete ? (
            <span className="topic-field-done">
              <i className="fa-solid fa-check" aria-hidden="true" />
              {skipped ? "Passé" : "Renseigné"}
            </span>
          ) : null}
        </div>
        {question.help ? (
          <p className="topic-field-sub">{question.help}</p>
        ) : null}
        {invalid ? (
          <p className="topic-field-error" role="alert">
            Ce champ obligatoire doit être renseigné.
          </p>
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
          <TopicSelect
            aria-label={question.label}
            value={
              typeof value === "string" && value
                ? value
                : question.id === "writing_language"
                  ? "fr"
                  : ""
            }
            tabIndex={skipped ? -1 : undefined}
            onChange={(next) =>
              onChange(
                next || (question.id === "writing_language" ? "fr" : next),
              )
            }
            allowEmpty={question.id !== "writing_language"}
            groups={question.optionGroups}
            options={
              question.optionGroups?.length ? undefined : question.options
            }
          />
        )}

        {question.type === "multi" && (
          <TopicMultiSelect
            aria-label={question.label}
            value={Array.isArray(value) ? (value as string[]) : []}
            tabIndex={skipped ? -1 : undefined}
            onChange={onChange}
            options={question.options || []}
            placeholder="Sélectionner…"
          />
        )}

        {question.type === "text_short" && (
          <div className="topic-text-block">
            <textarea
              rows={2}
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
              const min = question.min ?? 0;
              const max = question.max ?? 3;
              return (
                <label key={opt.value} className="topic-scale-row">
                  <span>{opt.label}</span>
                  <TopicSelect
                    compact
                    aria-label={"Niveau — " + opt.label}
                    placeholder="Niveau…"
                    value={current === undefined ? "" : String(current)}
                    tabIndex={skipped ? -1 : undefined}
                    onChange={(raw) => {
                      const next = { ...map };
                      if (raw === "") delete next[opt.value];
                      else next[opt.value] = Number(raw);
                      onChange(next);
                    }}
                    options={Array.from(
                      { length: max - min + 1 },
                      (_, i) => min + i,
                    ).map((n) => ({
                      value: String(n),
                      label:
                        question.scaleLabels?.[n - min] ??
                        (n === 0 ? "Aucun" : String(n)),
                    }))}
                  />
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
                <TopicSelect
                  compact
                  placeholder="Choisir"
                  value={row[f.id] || ""}
                  onChange={(next) => update(index, f.id, next)}
                  options={f.options}
                />
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
