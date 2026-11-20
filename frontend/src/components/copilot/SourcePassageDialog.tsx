import { useEffect, useMemo, useRef } from "react";
import { materialCode, materialText } from "../../../../shared/research/project";

export type PassagePayload = {
  m: any;
  quote: string;
  start?: number;
  end?: number;
  source?: string;
};

/** Localise un extrait même si les espaces ont été normalisés. */
export function findQuoteRange(
  text: string,
  quote: string,
  start?: number,
  end?: number,
): { start: number; end: number } | null {
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    start >= 0 &&
    end > start &&
    end <= text.length
  ) {
    return { start, end };
  }
  const needle = String(quote || "")
    .replace(/…$/u, "")
    .replace(/\.\.\.$/, "")
    .trim();
  if (!needle || !text) return null;
  const exact = text.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };

  // Correspondance en ignorant les différences d’espaces / retours ligne.
  const compact = (s: string) => s.replace(/\s+/g, " ").trim();
  const hay = compact(text);
  const q = compact(needle);
  const at = hay.indexOf(q);
  if (at < 0) return null;

  const mapIndex = (compactIndex: number) => {
    let c = 0;
    let i = 0;
    while (i < text.length) {
      if (/\s/.test(text[i])) {
        if (c < hay.length && hay[c] === " ") c++;
        while (i + 1 < text.length && /\s/.test(text[i + 1])) i++;
      } else {
        if (c === compactIndex) return i;
        c++;
      }
      i++;
    }
    return text.length;
  };

  const mappedStart = mapIndex(at);
  const mappedEnd = mapIndex(at + q.length);
  if (mappedEnd <= mappedStart) return null;
  return { start: mappedStart, end: mappedEnd };
}

function SourcePassage({
  text,
  quote,
  start,
  end,
}: {
  text: string;
  quote: string;
  start?: number;
  end?: number;
}) {
  const markRef = useRef<HTMLElement | null>(null);
  const range = useMemo(
    () => findQuoteRange(text, quote, start, end),
    [text, quote, start, end],
  );

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [range?.start, range?.end, text]);

  if (!text.trim()) {
    return <p>Aucun texte exploitable sur cette fiche.</p>;
  }
  if (!range) {
    return (
      <div className="source-passage-wrap">
        <p className="source-passage-miss" role="status">
          Le passage cité n’a pas pu être localisé dans la version actuelle de
          la fiche. Texte intégral ci-dessous.
        </p>
        <p className="source-passage">{text}</p>
      </div>
    );
  }

  const before = text.slice(0, range.start);
  const retained = text.slice(range.start, range.end);
  const after = text.slice(range.end);

  return (
    <div className="source-passage-wrap">
      <p className="source-passage-legend">
        <span className="source-passage-chip">Passage retenu</span>
        Mis en évidence dans le texte complet du matériau.
      </p>
      <p className="source-passage">
        {before}
        <mark ref={markRef as any} className="source-passage-mark">
          {retained}
        </mark>
        {after}
      </p>
    </div>
  );
}

type Props = {
  reading: PassagePayload;
  onClose: () => void;
};

export default function SourcePassageDialog({ reading, onClose }: Props) {
  const text = materialText(reading.m);
  const range = findQuoteRange(text, reading.quote, reading.start, reading.end);
  const beforeLen = range ? range.start : 0;
  const afterLen = range ? Math.max(0, text.length - range.end) : 0;
  const retainedLen = range ? range.end - range.start : 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog passage-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Matériau source"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialoghead">
          <div>
            <h2>{reading.m.title}</h2>
            <small>
              {materialCode(reading.m)} · {reading.m.type || reading.m.source}
            </small>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Fermer
          </button>
        </div>

        <div className="passage-meta">
          <span>
            {text.length.toLocaleString("fr-FR")} caractère
            {text.length > 1 ? "s" : ""}
          </span>
          {range && (
            <span>
              Extrait : {retainedLen.toLocaleString("fr-FR")} car. · avant{" "}
              {beforeLen.toLocaleString("fr-FR")} · après{" "}
              {afterLen.toLocaleString("fr-FR")}
            </span>
          )}
        </div>
        {reading.source === "transcription-ia" && (
          <p className="passage-transcription-note" role="note">
            Transcription automatique — à vérifier sur l’original
          </p>
        )}

        <SourcePassage
          text={text}
          quote={reading.quote}
          start={reading.start}
          end={reading.end}
        />

        {(reading.m.file || reading.m.toolFile) && (
          <div className="passage-files">
            {reading.m.file && (
              <a href={"/api/workspace?file=" + reading.m.file}>
                Télécharger les données
              </a>
            )}
            {reading.m.toolFile && (
              <a href={"/api/workspace?file=" + reading.m.toolFile}>
                Télécharger l’outil
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
