import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { materialCode } from "../../../../shared/research/project";
import {
  documentTypeLabel,
  writingTimeDays,
  writingTimeLabel,
} from "../../../../shared/research/corpusOrganization";
import {
  buildWorkPlan,
  findSubmissionEndDate,
} from "../../../../shared/research/workPlan";
import {
  buildWritingSchedule,
  workPlanToWritingSchedule,
} from "../../../../shared/research/writingSchedule";
import TopicSelect from "../topics/TopicSelect";
import type { PassagePayload } from "./SourcePassageDialog";
import { downloadPlanDocx } from "./downloadPlanDocx";
import WorkPlanView from "./WorkPlanView";

const REVISION_MIN = 12;
const REVISION_MAX = 1200;
const EVIDENCE_PAGE = 5;
const EVIDENCE_MORE = 10;
const SEARCH_DEBOUNCE_MS = 200;

type TabId = "plan" | "planning";

type SectionMeta = {
  index: number;
  title: string;
  advice: string;
  evidence: any[];
  matchingEvidence: any[];
  materialCount: number;
  evidenceCount: number;
  matchCount: number;
  hasMatch: boolean;
};

type Props = {
  p: any;
  draft: any;
  result: any;
  busy?: boolean;
  onBack: () => void;
  onOpenPassage: (payload: PassagePayload) => void;
  onRegenerate?: (feedback: string) => Promise<void> | void;
};

function tabStorageKey(projectId: string) {
  return `manuscrit:writing-plan-tab:${projectId}`;
}

function readStoredTab(projectId: string): TabId {
  try {
    const v = localStorage.getItem(tabStorageKey(projectId));
    return v === "planning" ? "planning" : "plan";
  } catch {
    return "plan";
  }
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export default function WritingPlanView({
  p,
  draft,
  result,
  busy = false,
  onBack,
  onOpenPassage,
  onRegenerate,
}: Props) {
  const [dlBusy, setDlBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showRevision, setShowRevision] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    readStoredTab(String(p?.id || "")),
  );
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [visibleCount, setVisibleCount] = useState<Record<number, number>>({});
  const [tocOpen, setTocOpen] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [printMode, setPrintMode] = useState(false);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setActiveTab(readStoredTab(String(p?.id || "")));
    setExpanded({});
    setVisibleCount({});
    setQuery("");
    setDebouncedQuery("");
    setMaterialFilter("");
  }, [p?.id, result?.date, result?.fingerprint]);

  useEffect(() => {
    try {
      localStorage.setItem(tabStorageKey(String(p?.id || "")), activeTab);
    } catch {
      /* ignore */
    }
  }, [activeTab, p?.id]);

  useEffect(() => {
    const t = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onBefore = () => setPrintMode(true);
    const onAfter = () => setPrintMode(false);
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  const workPlan = useMemo(() => {
    if (result?.workPlan?.phases?.length) return result.workPlan;
    return buildWorkPlan({
      writingTime: draft.writingTime,
      totalDays: writingTimeDays(draft.writingTime) || undefined,
      durationLabel: writingTimeLabel(draft.writingTime) || undefined,
      documentType: draft.documentType,
      documentTypeOther: draft.documentTypeOther,
      startDate: draft.startDate || undefined,
      endDate: findSubmissionEndDate(p?.dates),
      sections: result?.sections || [],
    });
  }, [result, draft, p?.dates]);

  const schedule = useMemo(() => {
    if (result?.schedule?.items?.length) return result.schedule;
    if (workPlan)
      return workPlanToWritingSchedule(
        workPlan,
        writingTimeLabel(draft.writingTime),
      );
    return buildWritingSchedule({
      writingTime: draft.writingTime,
      writingTimeDays: writingTimeDays(draft.writingTime),
      writingTimeLabel: writingTimeLabel(draft.writingTime),
      sections: result?.sections || [],
      documentType: draft.documentType,
      documentTypeOther: draft.documentTypeOther,
      startDate: draft.startDate || undefined,
      endDate: findSubmissionEndDate(p?.dates),
    });
  }, [result, draft, workPlan, p?.dates]);

  const materialsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of p.materials || []) map.set(m.id, m);
    return map;
  }, [p.materials]);

  const sections = useMemo(
    () => (Array.isArray(result?.sections) ? result.sections : []),
    [result?.sections],
  );

  const qNorm = useMemo(
    () => (debouncedQuery ? norm(debouncedQuery) : ""),
    [debouncedQuery],
  );

  const sectionMeta = useMemo((): SectionMeta[] => {
    return sections.map((s: any, index: number) => {
      const evidence = Array.isArray(s.evidence) ? s.evidence : [];
      const titleHit = !qNorm || norm(String(s.title || "")).includes(qNorm);
      const adviceHit = !qNorm || norm(String(s.advice || "")).includes(qNorm);
      const sectionTextHit = titleHit || adviceHit;

      const matchingEvidence = evidence.filter((ev: any) => {
        if (materialFilter && ev.id !== materialFilter) return false;
        if (!qNorm) return true;
        if (sectionTextHit) return true;
        return norm(String(ev.quote || "")).includes(qNorm);
      });

      const materialIds = new Set(
        evidence.map((ev: any) => ev.id).filter(Boolean),
      );

      const hasMatch =
        !qNorm && !materialFilter
          ? true
          : materialFilter
            ? matchingEvidence.length > 0
            : sectionTextHit || matchingEvidence.length > 0;

      return {
        index,
        title: String(s.title || "Section"),
        advice: String(s.advice || ""),
        evidence,
        matchingEvidence,
        materialCount: materialIds.size,
        evidenceCount: evidence.length,
        matchCount: matchingEvidence.length,
        hasMatch,
      };
    });
  }, [sections, qNorm, materialFilter]);

  const materialOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sections) {
      for (const ev of s.evidence || []) {
        if (!ev?.id) continue;
        counts.set(ev.id, (counts.get(ev.id) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([id, count]) => {
        const m = materialsById.get(id);
        return {
          id,
          count,
          label: m
            ? `${materialCode(m)} · ${m.title}`
            : id,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [sections, materialsById]);

  const totalMatching = useMemo(
    () => sectionMeta.reduce((a, s) => a + s.matchCount, 0),
    [sectionMeta],
  );

  const displayedMatching = useMemo(() => {
    if (printMode) return totalMatching;
    return sectionMeta.reduce((a, s) => {
      if (!expanded[s.index]) return a;
      const lim = visibleCount[s.index] ?? EVIDENCE_PAGE;
      return a + Math.min(lim, s.matchCount);
    }, 0);
  }, [sectionMeta, expanded, visibleCount, printMode, totalMatching]);

  useEffect(() => {
    if (activeTab !== "plan") return;
    const nodes = sectionRefs.current.filter(Boolean) as HTMLElement[];
    if (!nodes.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (!visible.length) return;
        const id = visible[0].target.getAttribute("data-section-index");
        if (id != null) setActiveSection(Number(id));
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.1, 0.35, 0.6] },
    );
    for (const n of nodes) obs.observe(n);
    return () => obs.disconnect();
  }, [activeTab, sectionMeta.length]);

  const revisionOk =
    feedback.trim().length >= REVISION_MIN &&
    feedback.trim().length <= REVISION_MAX;

  const selectTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
  }, []);

  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const order: TabId[] = ["plan", "planning"];
    const i = order.indexOf(activeTab);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % 2;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + order.length) % order.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = order.length - 1;
    if (next < 0) return;
    e.preventDefault();
    selectTab(order[next]);
    tabRefs.current[next]?.focus();
  }

  async function downloadWord(kind: "plan" | "schedule") {
    if (dlBusy || busy || !result) return;
    selectTab(kind === "schedule" ? "planning" : "plan");
    if (kind === "schedule" && !schedule?.items?.length) {
      setMsg(
        "Aucun planning à télécharger. Indiquez un temps de rédaction dans le cadrage.",
      );
      return;
    }
    setDlBusy(true);
    setMsg("");
    try {
      await downloadPlanDocx({
        kind,
        projectTitle: p.title,
        documentLabel: documentTypeLabel(
          draft.documentType,
          draft.documentTypeOther,
        ),
        plan: {
          ...result,
          schedule: kind === "schedule" ? schedule : undefined,
          workPlan: kind === "schedule" ? workPlan || result.workPlan : undefined,
          sections: kind === "plan" ? result.sections : undefined,
          gaps: kind === "plan" ? result.gaps : undefined,
        },
        materials: (p.materials || []).map((m: any) => ({
          id: m.id,
          title: m.title,
          type: m.type,
        })),
      });
      setMsg(
        kind === "schedule"
          ? "Planning téléchargé (Word)."
          : "Plan de rédaction téléchargé (Word).",
      );
    } catch (e: any) {
      setMsg(e.message || "Téléchargement Word impossible.");
    } finally {
      setDlBusy(false);
    }
  }

  async function submitRevision() {
    if (!onRegenerate || busy || !revisionOk) return;
    setMsg("");
    try {
      await onRegenerate(feedback.trim());
      setShowRevision(false);
      setFeedback("");
    } catch (e: any) {
      setMsg(e.message || "Regénération impossible.");
    }
  }

  function scrollToSection(index: number) {
    const el = sectionRefs.current[index];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(index);
    setTocOpen(false);
  }

  function expandAll() {
    const next: Record<number, boolean> = {};
    const counts: Record<number, number> = {};
    for (const s of sectionMeta) {
      next[s.index] = true;
      counts[s.index] = Math.max(
        visibleCount[s.index] ?? EVIDENCE_PAGE,
        Math.min(EVIDENCE_PAGE, s.matchCount) || EVIDENCE_PAGE,
      );
    }
    setExpanded(next);
    setVisibleCount((prev) => ({ ...prev, ...counts }));
  }

  function collapseAll() {
    setExpanded({});
  }

  function toggleSection(index: number) {
    setExpanded((prev) => {
      const open = !prev[index];
      if (open) {
        setVisibleCount((c) => ({
          ...c,
          [index]: c[index] ?? EVIDENCE_PAGE,
        }));
      }
      return { ...prev, [index]: open };
    });
  }

  function showMore(index: number) {
    setVisibleCount((prev) => ({
      ...prev,
      [index]: (prev[index] ?? EVIDENCE_PAGE) + EVIDENCE_MORE,
    }));
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
          <i className="fa-solid fa-arrow-left" aria-hidden="true" />{" "}
          Mes projets
        </button>
        <p className="topic-flow-context">
          {result?.simulated
            ? "Aperçu du plan de rédaction"
            : "Plan de rédaction"}
          <small>
            {p.demo ? "Parcours d’exemple" : `${p.title}, ${p.type}`}
          </small>
        </p>
      </div>

      <section className="cp-card proposal writing-plan-page">
        {result.simulated ? (
          <div className="corpus-sim-banner" role="status">
            <strong>Aperçu simulé</strong>
            <span>
              Structure type et extraits de vos matériaux. À remplacer plus tard
              par un plan produit via le service IA.
            </span>
          </div>
        ) : null}

        {result.revisionFeedback ? (
          <div className="corpus-revision-banner" role="status">
            <strong>Révision demandée</strong>
            <span>« {result.revisionFeedback} »</span>
          </div>
        ) : null}

        <div className="writing-plan-toolbar">
          <small>
            {result.simulated ? "Simulation" : "Proposition"} du{" "}
            {new Date(result.date).toLocaleString("fr-FR")}
            {result.model ? ` · ${result.model}` : ""}
          </small>
          <div className="writing-plan-actions">
            <button
              type="button"
              className="writing-plan-dl secondary"
              disabled={dlBusy || busy || !result?.sections?.length}
              onClick={() => void downloadWord("plan")}
            >
              <i className="fa-solid fa-file-word" aria-hidden="true" />{" "}
              Plan rédaction
            </button>
            <button
              type="button"
              className="writing-plan-dl secondary"
              disabled={dlBusy || busy || !schedule?.items?.length}
              onClick={() => void downloadWord("schedule")}
            >
              <i className="fa-solid fa-file-word" aria-hidden="true" />{" "}
              Planning
            </button>
            {onRegenerate && (
              <button
                type="button"
                className="primary writing-plan-regen"
                disabled={busy}
                onClick={() => setShowRevision((v) => !v)}
              >
                <i className="fa-solid fa-rotate" aria-hidden="true" />{" "}
                {showRevision ? "Fermer" : "Regénérer"}
              </button>
            )}
          </div>
        </div>

        {showRevision && onRegenerate && (
          <section className="writing-revision" aria-label="Regénérer le plan">
            <h3>Regénérer en précisant les améliorations</h3>
            <p>
              Indiquez ce que le prochain plan doit mieux prendre en compte par
              rapport à cette version (sections trop longues, preuves
              manquantes, fil argumentatif, etc.).
            </p>
            <label>
              Consignes pour l’IA{" "}
              <span className="req" aria-hidden="true">
                *
              </span>
              <textarea
                rows={4}
                maxLength={REVISION_MAX}
                value={feedback}
                disabled={busy}
                placeholder="Ex. Renforcer le lien entre les entretiens et la problématique ; alléger l’introduction ; préciser comment mobiliser le tableau statistique…"
                onChange={(e) => setFeedback(e.target.value)}
              />
              <span
                className={
                  feedback.trim().length > 0 && !revisionOk
                    ? "field-count is-invalid"
                    : "field-count"
                }
              >
                {feedback.trim().length} / {REVISION_MAX} · minimum{" "}
                {REVISION_MIN} caractères
              </span>
            </label>
            <div className="cp-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setShowRevision(false);
                  setFeedback("");
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !revisionOk}
                onClick={() => void submitRevision()}
              >
                {busy
                  ? "Regénération…"
                  : "Lancer la regénération"}{" "}
                <i className="fa-solid fa-arrow-right" />
              </button>
            </div>
          </section>
        )}

        <div
          className="writing-plan-tabs"
          role="tablist"
          aria-label="Plan de rédaction et planning"
          onKeyDown={onTabKeyDown}
        >
          <button
            ref={(el) => {
              tabRefs.current[0] = el;
            }}
            type="button"
            role="tab"
            id="writing-tab-plan"
            aria-selected={activeTab === "plan"}
            aria-controls="writing-panel-plan"
            tabIndex={activeTab === "plan" ? 0 : -1}
            className={
              activeTab === "plan"
                ? "writing-plan-tab is-active"
                : "writing-plan-tab"
            }
            onClick={() => selectTab("plan")}
          >
            Plan de rédaction
          </button>
          <button
            ref={(el) => {
              tabRefs.current[1] = el;
            }}
            type="button"
            role="tab"
            id="writing-tab-planning"
            aria-selected={activeTab === "planning"}
            aria-controls="writing-panel-planning"
            tabIndex={activeTab === "planning" ? 0 : -1}
            className={
              activeTab === "planning"
                ? "writing-plan-tab is-active"
                : "writing-plan-tab"
            }
            onClick={() => selectTab("planning")}
          >
            Planning
          </button>
        </div>

        {activeTab === "plan" ? (
          <div
            role="tabpanel"
            id="writing-panel-plan"
            aria-labelledby="writing-tab-plan"
            className="writing-plan-panel"
          >
            <h2>
              {result.simulated
                ? "Aperçu du plan de rédaction"
                : "Plan de rédaction"}
            </h2>
            <p>
              Guide d’écriture ancré dans vos matériaux. Cliquez sur la flèche
              d’un extrait pour ouvrir le matériau et voir le passage retenu
              dans le texte. Ce n’est pas le texte final.
            </p>

            <div className="writing-plan-preview-tools">
              <label className="writing-plan-search">
                <span className="topic-sr-only">Rechercher dans l’aperçu</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Rechercher (titres, conseils, extraits)…"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label className="writing-plan-filter field-select">
                <span className="topic-sr-only">Filtrer par matériau</span>
                <TopicSelect
                  value={materialFilter}
                  onChange={setMaterialFilter}
                  placeholder="Tous les matériaux"
                  allowEmpty
                  aria-label="Filtrer par matériau"
                  options={materialOptions.map((o) => ({
                    value: o.id,
                    label: `${o.label} (${o.count})`,
                  }))}
                />
              </label>
              <div className="writing-plan-preview-actions">
                <button
                  type="button"
                  className="writing-plan-tool-btn secondary"
                  onClick={expandAll}
                >
                  Tout déplier
                </button>
                <button
                  type="button"
                  className="writing-plan-tool-btn secondary"
                  onClick={collapseAll}
                >
                  Tout replier
                </button>
              </div>
              <p className="writing-plan-evidence-count" aria-live="polite">
                {displayedMatching} extrait
                {displayedMatching !== 1 ? "s" : ""} affiché
                {displayedMatching !== 1 ? "s" : ""} sur {totalMatching}
              </p>
            </div>

            <button
              type="button"
              className="writing-plan-toc-toggle secondary"
              aria-expanded={tocOpen}
              onClick={() => setTocOpen((v) => !v)}
            >
              {tocOpen ? "Masquer le sommaire" : "Sommaire des sections"}
            </button>

            <div className="writing-plan-layout">
              <nav
                className={
                  tocOpen
                    ? "writing-plan-toc is-open"
                    : "writing-plan-toc"
                }
                aria-label="Sommaire du plan"
              >
                <p className="writing-plan-toc-title">Sections</p>
                <ol>
                  {sectionMeta.map((s) => (
                    <li key={s.index}>
                      <button
                        type="button"
                        className={[
                          "writing-plan-toc-item",
                          activeSection === s.index ? "is-current" : "",
                          !s.hasMatch ? "is-dimmed" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => scrollToSection(s.index)}
                      >
                        <span className="writing-plan-toc-label">
                          {s.index + 1}. {s.title}
                        </span>
                        <span className="writing-plan-toc-badge">
                          {s.evidenceCount} extrait
                          {s.evidenceCount !== 1 ? "s" : ""} · {s.materialCount}{" "}
                          matériau{s.materialCount !== 1 ? "x" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>

              <div className="writing-plan-sections">
                {sectionMeta.map((s) => {
                  const isOpen = printMode || Boolean(expanded[s.index]);
                  const limit = printMode
                    ? s.matchCount
                    : (visibleCount[s.index] ?? EVIDENCE_PAGE);
                  const shown = isOpen
                    ? s.matchingEvidence.slice(0, limit)
                    : [];
                  const remaining = Math.max(0, s.matchCount - limit);

                  return (
                    <article
                      key={s.index}
                      ref={(el) => {
                        sectionRefs.current[s.index] = el;
                      }}
                      data-section-index={s.index}
                      id={`writing-section-${s.index}`}
                      className={
                        !s.hasMatch
                          ? "writing-plan-section is-dimmed"
                          : "writing-plan-section"
                      }
                    >
                      <h3>
                        {s.index + 1}. {s.title}
                      </h3>
                      <p>{s.advice}</p>

                      {s.matchCount > 0 && (
                        <div className="writing-plan-evidence-block">
                          {!printMode && (
                            <button
                              type="button"
                              className="secondary writing-plan-evidence-toggle"
                              aria-expanded={isOpen}
                              onClick={() => toggleSection(s.index)}
                            >
                              {isOpen
                                ? "Replier les extraits"
                                : `Voir les ${s.matchCount} extrait${
                                    s.matchCount !== 1 ? "s" : ""
                                  }`}
                            </button>
                          )}

                          {isOpen && (
                            <div className="writing-plan-evidence-list">
                              {shown.map((v: any, j: number) => {
                                const m = materialsById.get(v.id);
                                return (
                                  <blockquote
                                    key={`${v.id}-${j}-${v.start}`}
                                    className="writing-plan-quote"
                                  >
                                    <p>« {v.quote} »</p>
                                    {m && (
                                      <div className="writing-plan-cite">
                                        <span>
                                          {materialCode(m)} · {m.title}
                                        </span>
                                        <button
                                          type="button"
                                          className="writing-plan-open"
                                          title="Ouvrir le matériau et le passage retenu"
                                          aria-label={`Ouvrir le matériau ${m.title}`}
                                          onClick={() =>
                                            onOpenPassage({
                                              m,
                                              quote: v.quote,
                                              start: v.start,
                                              end: v.end,
                                            })
                                          }
                                        >
                                          <i className="fa-solid fa-arrow-up-right-from-square" />
                                        </button>
                                      </div>
                                    )}
                                  </blockquote>
                                );
                              })}
                              {!printMode && remaining > 0 && (
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => showMore(s.index)}
                                >
                                  Afficher {Math.min(EVIDENCE_MORE, remaining)}{" "}
                                  de plus
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>

            {result.gaps?.length > 0 && (
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
            {result.references?.length ? (
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
          </div>
        ) : (
          <div
            role="tabpanel"
            id="writing-panel-planning"
            aria-labelledby="writing-tab-planning"
            className="writing-plan-panel"
          >
            <h2>Planning de rédaction</h2>
            {workPlan?.phases?.length ? (
              <WorkPlanView plan={workPlan} />
            ) : schedule?.items?.length ? (
              <section className="writing-schedule">
                <h3>
                  Planning de rédaction
                  {schedule.label ? ` · ${schedule.label}` : ""}
                </h3>
                <p>
                  Jalons indicatifs selon le temps déclaré et les sections du
                  plan. À adapter à votre rythme.
                </p>
                <ol className="writing-schedule-list">
                  {schedule.items.map((item: any, i: number) => (
                    <li key={`${item.title}-${i}`}>
                      <strong>
                        Jours {item.dayStart}–{item.dayEnd}
                        {item.share ? ` · ${item.share}` : ""}
                      </strong>
                      <span>{item.title}</span>
                      {item.advice && <small>{item.advice}</small>}
                    </li>
                  ))}
                </ol>
              </section>
            ) : (
              <p>
                Aucun planning disponible. Indiquez un temps de rédaction dans
                le cadrage, puis relancez le plan.
              </p>
            )}
          </div>
        )}

        {result.fingerprint && (
          <small>
            Empreinte {result.fingerprint} · {result.version}
          </small>
        )}

        {msg && (
          <p role="status" className="cp-message">
            {msg}
          </p>
        )}
      </section>
    </section>
  );
}
