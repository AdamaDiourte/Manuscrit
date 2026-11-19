
import { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  LayoutDashboard,
  FolderOpen,
  NotebookPen,
  ListChecks,
  CalendarDays,
  MessageSquare,
  History,
  LayoutTemplate,
  ChevronDown,
  ChevronRight,
  Plus,
  ArrowUpRight,
  ArrowRight,
  BookMarked,
  Files,
  Clock3,
  Menu,
  X,
  Search,
  Pencil,
  Download,
  Check,
  LibraryBig,
  PanelLeft,
  Folder,
  Flag,
  FileText,
  Bookmark,
  Home,
} from "lucide-react";
import {
  templates,
  TOOL_TYPE_OPTIONS,
  DATA_TYPE_OPTIONS,
  isNoTool,
  makeProject,
  demo,
  PROJECT_MODEL_OPTIONS,
  projectTypeLabel,
} from "../data/projectTemplates";
import ResearchStudio, {
  keepCorpusStartFlow,
  type ResearchPage,
} from "../components/copilot/ResearchStudio";
import { mergeTopicArchives } from "../components/topics/topicArchive";
import TopicSelect from "../components/topics/TopicSelect";
import LegalPage, {
  isLegalPage,
  legalPages,
} from "../components/LegalPage";
const researchPages: ResearchPage[] = [
  "Accueil",
  "Construire mon projet",
  "Organiser mon manuscrit",
];
const isResearchPage = (v: string): v is ResearchPage =>
  researchPages.includes(v as ResearchPage);
import Subscriptions from "../components/copilot/Subscriptions";
import Attestation from "../components/copilot/Attestation";
import { materialCode } from "../../../shared/research/project";
import Book from "../components/Book";
const nav: any = [
  ["Tableau de bord", LayoutDashboard],
  ["Matériaux", FolderOpen],
  ["Rédaction", NotebookPen],
  ["Points à vérifier", ListChecks],
  ["Échéances", CalendarDays],
  ["Commentaires", MessageSquare],
  ["Versions", History],
  ["Modèles", LayoutTemplate],
];
const colors = ["teal", "slate", "orange", "blue"];
const dateStr = (s: string) =>
  s
    ? new Date(s + "T12:00:00").toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Non renseignée";
const chapterStatus = (n: number) =>
  n === 100 ? "Terminé" : n === 0 ? "À commencer" : "En cours";
const progressTone = (n: number) =>
  n >= 100 ? "done" : n >= 60 ? "mid" : n > 0 ? "low" : "none";
const defaultData = { projects: [demo] };
export default function Page() {
  const [data, setData] = useState<any>(defaultData),
    [pid, setPid] = useState("exemple"),
    [view, V] = useState("Accueil"),
    [modal, M] = useState(""),
    [form, F] = useState<any>({}),
    [err, E] = useState(""),
    [ready, R] = useState(false),
    [busy, B] = useState(false),
    [open, O] = useState(false),
    [search, S] = useState(""),
    [filter, K] = useState<any>({}),
    [file, H] = useState<File | null>(null),
    [toolFile, setToolFile] = useState<File | null>(null),
    [loadErr, L] = useState(false);
  const [attested, attest] = useState(false);
  const rev = useRef(""),
    lock = useRef(false),
    dataRef = useRef(data);
  dataRef.current = data;
  const p = data.projects.find((x: any) => x.id === pid) || data.projects[0],
    cs = p.chapters,
    pct = Math.round(
      cs.reduce((a: number, c: any) => a + c.progress, 0) / (cs.length || 1),
    ),
    pending = p.tasks.filter((x: any) => x.status !== "Résolu"),
    dates = [...p.dates].sort((a, b) => a.date.localeCompare(b.date)),
    chap = (id: string) => cs.find((c: any) => c.id === id)?.title || "Projet";
  const materialSaveReady = (() => {
    if (modal !== "material") return true;
    if (!(form.title || "").trim()) return false;
    if (!(form.toolType || "").trim()) return false;
    if (!(form.type || "").trim()) return false;
    const toolOk =
      isNoTool(form.toolType) ||
      form.toolUnavailable ||
      Boolean(toolFile || form.toolFile);
    if (!toolOk) return false;
    if (!file && !form.file) return false;
    if (!attested) return false;
    return true;
  })();
  const formSaveReady =
    modal === "material"
      ? materialSaveReady
      : modal === "project"
        ? Boolean(
            (form.title || "").trim() &&
              form.type &&
              (form.type !== "Autre" || (form.typeOther || "").trim()),
          )
        : Boolean((form.title || "").trim());
  async function attemptLoad(): Promise<boolean> {
    try {
      const r = await fetch("/api/workspace", { cache: "no-store" });
      if (!r.ok) return false;
      const a = (await r.json()) as any;
      rev.current = a.rev;
      if (a.data) setData(a.data);
      R(true);
      L(false);
      return true;
    } catch {
      return false;
    }
  }
  /** GET workspace avec 3 retries (1s, 2s, 4s) avant alerte. */
  async function load(signal?: { cancelled: boolean }) {
    L(false);
    if (await attemptLoad()) return;
    for (const delay of [1000, 2000, 4000]) {
      await new Promise((r) => setTimeout(r, delay));
      if (signal?.cancelled) return;
      if (await attemptLoad()) return;
    }
    if (!signal?.cancelled) L(true);
  }
  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    if (new URLSearchParams(location.search).get("billing") === "return")
      V("Abonnement");
    return () => {
      signal.cancelled = true;
    };
  }, []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !lock.current) {
        M("");
        O(false);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  function go(v: string) {
    V(v);
    O(false);
    M("");
    S("");
    K({});
    E("");
  }
  function edit(m: string, f: any = {}) {
    E("");
    attest(false);
    H(null);
    setToolFile(null);
    F(structuredClone(f));
    M(m);
    O(false);
  }
  const val = (key: string, v: any) => F((f: any) => ({ ...f, [key]: v }));
  function newMaterial() {
    edit("material", {
      id: crypto.randomUUID(),
      toolType: "Grille d’entretien",
      type: "Entretien réalisé",
      observation: "",
      toolUnavailable: false,
      extra: {},
    });
  }
  async function uploadAttachedFile(selected: File) {
    if (selected.size > 20 * 1024 * 1024)
      throw Error("Le fichier dépasse 20 Mo.");
    let extracted = "";
    if (/\.(txt|md|csv|tsv|pdf|docx|xlsx)$/i.test(selected.name)) {
      const { extractText } = await import("../services/import/extractText");
      try {
        extracted = await extractText(selected);
      } catch {
        extracted = "";
      }
    }
    const r = await fetch(
      "/api/workspace?upload=1&name=" + encodeURIComponent(selected.name),
      {
        method: "POST",
        headers: { "X-Deposit-Attested": "yes" },
        body: selected,
      },
    );
    if (!r.ok) throw Error("Le dépôt du fichier a échoué.");
    return {
      id: ((await r.json()) as { id: string }).id,
      filename: selected.name,
      extracted,
    };
  }
  function project(type = "Mémoire") {
    edit("project", { type });
  }
  async function deleteProject(projectId: string) {
    if (lock.current) throw Error("Chargement ou sauvegarde en cours.");
    const target = dataRef.current.projects.find((x: any) => x.id === projectId);
    if (!target) throw Error("Projet introuvable.");
    if (target.demo) throw Error("Le projet d’exemple ne peut pas être supprimé.");
    lock.current = true;
    try {
      const next = structuredClone(dataRef.current);
      next.projects = next.projects.filter((x: any) => x.id !== projectId);
      if (!next.projects.length) next.projects = [demo];
      await commit(next);
      if (pid === projectId) {
        const fallback =
          next.projects.find((x: any) => !x.demo)?.id || next.projects[0].id;
        setPid(fallback);
      }
    } finally {
      lock.current = false;
    }
  }
  async function commit(next: any) {
    // Garde-fou : jamais POST defaultData / état local tant que le GET n’a pas réussi.
    if (!ready)
      throw Error("Le chargement doit être terminé avant l’enregistrement.");
    const r = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: next, rev: rev.current, attested: true }),
    });
    if (r.status === 409)
      throw Error(
        "Ce projet a changé dans une autre fenêtre. Copiez votre saisie et rechargez la page.",
      );
    if (!r.ok)
      throw Error(
        r.status === 413
          ? "La limite de stockage de l’espace est atteinte."
          : "L’enregistrement a échoué.",
      );
    rev.current = ((await r.json()) as { rev: string }).rev;
    setData(next);
  }
  async function saveDraft(draft: any) {
    if (!ready) throw Error("Chargement ou sauvegarde en cours.");
    for (let i = 0; i < 12 && lock.current; i++) {
      await new Promise((r) => setTimeout(r, 40 + i * 20));
    }
    if (lock.current) throw Error("Chargement ou sauvegarde en cours.");
    lock.current = true;
    try {
      const next = structuredClone(dataRef.current);
      const q = next.projects.find((x: any) => x.id === p.id);
      if (!q) throw Error("Projet introuvable.");
      const previous = q.copilot || {};
      const topicArchive = mergeTopicArchives(
        previous.topicArchive,
        draft.topicArchive,
      );
      q.copilot = {
        ...previous,
        ...draft,
        topicArchive,
        attestedAt: new Date().toISOString(),
      };
      await commit(next);
    } finally {
      lock.current = false;
    }
  }
  async function save(e: any) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    B(true);
    E("");
    try {
      if (!ready)
        throw Error("Le chargement doit être terminé avant l’enregistrement.");
      const next = structuredClone(data),
        q = next.projects.find((x: any) => x.id === p.id),
        a = { ...form };
      if (a.title !== undefined && !a.title.trim())
        throw Error("Renseignez un intitulé.");
      let newId = "";
      if (modal === "project") {
        if (!a.type) throw Error("Choisissez un type de projet.");
        if (a.type === "Autre" && !String(a.typeOther || "").trim())
          throw Error("Précisez le type de projet (catégorie Autre).");
        const n = makeProject(
          a.title.trim(),
          a.type,
          String(a.typeOther || ""),
        );
        next.projects.push(n);
        newId = n.id;
      } else {
        const key: any = (
          {
            material: "materials",
            chapter: "chapters",
            task: "tasks",
            date: "dates",
            comment: "comments",
          } as any
        )[modal];
        if (modal === "material") {
          if (!attested) throw Error("Confirmez les conditions de dépôt.");
          if (!(a.toolType || "").trim())
            throw Error("Indiquez l’outil de recueil.");
          if (!(a.type || "").trim())
            throw Error("Indiquez le type de données recueillies.");
          a.attestedAt = new Date().toISOString();
          const hasToolFile = Boolean(toolFile || a.toolFile);
          const hasDataFile = Boolean(file || a.file);
          const skipToolFile = a.toolUnavailable || isNoTool(a.toolType);
          if (skipToolFile) {
            a.toolFile = "";
            a.toolFilename = "";
            a.toolExtracted = "";
            if (isNoTool(a.toolType)) a.toolUnavailable = false;
            setToolFile(null);
          } else if (!hasToolFile) {
            throw Error(
              "Joignez le fichier de l’outil, ou déclarez l’outil indisponible.",
            );
          }
          if (!hasDataFile) {
            throw Error(
              "Joignez le fichier des données recueillies (obligatoire).",
            );
          }
          if (toolFile && !skipToolFile) {
            const up = await uploadAttachedFile(toolFile);
            if (
              !up.extracted &&
              /\.(png|jpe?g|webp|gif)$/i.test(toolFile.name) &&
              !a.observation?.trim()
            ) {
              throw Error(
                "Ajoutez une observation pour l’outil image ou scan.",
              );
            }
            a.toolFile = up.id;
            a.toolFilename = up.filename;
            a.toolExtracted = up.extracted;
          }
          if (file) {
            const up = await uploadAttachedFile(file);
            if (
              !up.extracted &&
              /\.(png|jpe?g|webp|gif)$/i.test(file.name) &&
              !a.observation?.trim() &&
              !a.text?.trim()
            ) {
              throw Error(
                "Ajoutez une observation pour les données image ou scan.",
              );
            }
            a.file = up.id;
            a.filename = up.filename;
            a.extracted = up.extracted;
          }
        } else if (file) {
          const up = await uploadAttachedFile(file);
          a.file = up.id;
          a.filename = up.filename;
          a.extracted = up.extracted;
        }
        if (!a.id) a.id = crypto.randomUUID();
        const i = q[key].findIndex((x: any) => x.id === a.id);
        const before = i < 0 ? null : q[key][i];
        if (i < 0) q[key].push(a);
        else q[key][i] = a;
        q.versions.unshift({
          id: crypto.randomUUID(),
          time: new Date().toISOString(),
          title: a.title,
          key,
          before,
          after: a,
          action: i < 0 ? "Création" : "Mise à jour",
        });
      }
      await commit(next);
      M("");
      if (newId) {
        if (view === "Organiser mon manuscrit") keepCorpusStartFlow();
        setPid(newId);
        // Depuis « Organiser mon manuscrit », rester dans le parcours (pas la page Démarrer).
        if (!isResearchPage(view)) go("Accueil");
      }
    } catch (ex: any) {
      E(ex.message || "Enregistrement impossible.");
    } finally {
      lock.current = false;
      B(false);
    }
  }
  function field(
    label: string,
    key: string,
    options?: string[],
    required = false,
    type = "text",
    placeholder = "",
  ) {
    return (
      <label>
        {label}
        {options ? (
          <select
            value={form[key] || ""}
            required={required}
            onChange={(e) => val(key, e.target.value)}
          >
            {!required && <option value="">Non renseigné</option>}
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : type === "area" ? (
          <textarea
            value={form[key] || ""}
            onChange={(e) => val(key, e.target.value)}
            rows={4}
            placeholder={placeholder || undefined}
          />
        ) : (
          <input
            required={required}
            type={type}
            value={form[key] || ""}
            onChange={(e) => val(key, e.target.value)}
            placeholder={placeholder || undefined}
          />
        )}
      </label>
    );
  }
  function chapterField() {
    return (
      <label>
        Chapitre
        <select
          value={form.chapter || ""}
          onChange={(e) => val("chapter", e.target.value)}
        >
          <option value="">Ensemble du projet</option>
          {cs.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function panelTitle(title: string, link: string, fn: any) {
    return (
      <div className="panelhead">
        <h2>{title}</h2>
        <button className="textbtn" onClick={fn}>
          {link} <ArrowRight size={14} />
        </button>
      </div>
    );
  }
  function chRows() {
    return cs.map((c: any, i: number) => {
      const tone = progressTone(c.progress);
      return (
        <button key={c.id} className="chrow" onClick={() => edit("chapter", c)}>
          <span className="num">{String(i + 1).padStart(2, "0")}</span>
          <span className="chname">
            {c.title}
            <small className={"prog-" + tone}>{chapterStatus(c.progress)}</small>
          </span>
          <span className={"track " + tone}>
            <i style={{ width: c.progress + "%" }} />
          </span>
          <span className={"percent prog-" + tone}>{c.progress} %</span>
          <ChevronRight size={14} />
        </button>
      );
    });
  }
  function dateRow(x: any, i: number) {
    let d = new Date(x.date + "T12:00:00");
    return (
      <button key={x.id} className="daterow" onClick={() => edit("date", x)}>
        <span className={"datebox " + ["slate", "orange", "teal"][i % 3]}>
          <b>{d.getDate()}</b>
          {d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}
        </span>
        <span>
          {x.title}
          <small>{chap(x.chapter)}</small>
        </span>
      </button>
    );
  }
  function blank(msg: string) {
    return <p className="blank">{msg}</p>;
  }
  const metric: any = [
    [Files, "Matériaux", p.materials.length, "Dans le corpus", "Matériaux"],
    [BookOpen, "Chapitres", cs.length, "Dans le manuscrit", "Rédaction"],
    [
      Flag,
      "Points à vérifier",
      pending.length,
      "À traiter",
      "Points à vérifier",
    ],
    [CalendarDays, "Échéances", p.dates.length, "Au calendrier", "Échéances"],
  ];
  const newAction = () =>
    view === "Matériaux"
      ? newMaterial()
      : view === "Rédaction"
        ? edit("chapter", {
            progress: 0,
            sections: [],
            links: [],
            text: "",
            kind: "Section rédigée",
          })
        : view === "Points à vérifier"
          ? edit("task", { status: "À vérifier" })
          : view === "Échéances"
            ? edit("date")
            : view === "Commentaires"
              ? edit("comment", { type: "Commentaire", status: "Ouvert" })
              : project();
  const titles: any = {
    project: "Nouveau projet",
    material: "Fiche matériau",
    chapter: "Rédaction du chapitre",
    task: "Point à vérifier",
    date: "Échéance",
    comment: "Commentaire ou correction",
    version: "Détail de la version",
    projects: "Mes projets",
  };
  return (
    <div className="shell">
      {open && <div className="shade" onClick={() => O(false)} />}
      <aside className={open ? "side show" : "side"}>
        <button
          type="button"
          className="brand"
          aria-label="Retour à l’accueil"
          onClick={() => go("Accueil")}
        >
          <span className="brandico">
            <BookOpen size={25} />
          </span>
          Manuscrit
        </button>
        <div className="sidelabel">ESPACE DE TRAVAIL</div>
        <nav>
          <button
            className={view === "Accueil" ? "active" : ""}
            onClick={() => go("Accueil")}
          >
            <Home size={18} />
            Accueil
          </button>
          {nav.slice(0, 7).map(([n, I]: any) => (
            <button
              key={n}
              className={view === n ? "active" : ""}
              onClick={() => go(n)}
            >
              <I size={18} />
              {n}
              {n === "Points à vérifier" && pending.length > 0 && (
                <em>{pending.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidelabel sep">BIBLIOTHÈQUE</div>
        <nav>
          <button
            className={view === "Modèles" ? "active" : ""}
            onClick={() => go("Modèles")}
          >
            <LayoutTemplate size={18} />
            Modèles
          </button>
          <button
            className={view === "Abonnement" ? "active" : ""}
            onClick={() => go("Abonnement")}
          >
            <Bookmark size={18} />
            Abonnement
          </button>
        </nav>
        <button className="profile" onClick={() => edit("projects")}>
          <span className="avatar">DS</span>
          <span>
            DataSensia<small>Espace d’accompagnement</small>
          </span>
          <ChevronDown size={14} />
        </button>
      </aside>
      <main>
        <header>
          <div className="crumb">
            <button
              className="mobile"
              aria-label="Menu"
              onClick={() => O(true)}
            >
              <Menu />
            </button>
            <PanelLeft size={16} />
            <span>Mon espace</span>
            <ChevronRight size={13} />
            <strong>{view}</strong>
          </div>
          <button className="projectbtn" onClick={() => edit("projects")}>
            <Folder size={16} /> Mes projets <ChevronDown size={14} />
          </button>
        </header>
        <div className="wrap">
          {!ready && !loadErr && (
            <p role="status" className="workspace-load-status">
              Chargement de l’espace…
            </p>
          )}
          {loadErr && !ready && (
            <p role="alert" className="workspace-load-alert">
              Chargement du projet impossible.{" "}
              <button type="button" onClick={() => void load()}>
                Réessayer
              </button>
            </p>
          )}
          {ready && !isResearchPage(view) && (
            <div className="pagehead">
              <div>
                <h1>{view}</h1>
              </div>
              {!["Versions", "Modèles", "Abonnement", ...legalPages].includes(
                view,
              ) && (
                <button className="primary" onClick={newAction}>
                  <Plus size={17} />
                  {view === "Matériaux"
                    ? "Ajouter un matériau"
                    : view === "Rédaction"
                      ? "Nouveau chapitre"
                      : view === "Tableau de bord"
                        ? "Nouveau projet"
                        : "Ajouter"}
                </button>
              )}
            </div>
          )}
          {ready &&
            (isResearchPage(view) ? (
            <ResearchStudio
              key={view + p.id + String(ready)}
              page={view}
              p={p}
              projects={data.projects.map((x: any) => {
                const draft = x.copilot || {};
                const plan = draft.corpusResult;
                return {
                  id: x.id,
                  title: x.title,
                  type: x.type,
                  typeOther: x.typeOther,
                  demo: x.demo,
                  materials: (x.materials || []).map((m: any) => ({
                    id: m.id,
                    title: m.title,
                    type: m.type,
                    hasText: Boolean(
                      [m.observation, m.text, m.extracted, m.toolExtracted]
                        .filter(Boolean)
                        .join("")
                        .trim(),
                    ),
                  })),
                  frame: {
                    documentType: draft.documentType,
                    documentTypeOther: draft.documentTypeOther,
                    discipline: draft.discipline,
                    disciplineOther: draft.disciplineOther,
                    expectedLength: draft.expectedLength,
                    writingTime: draft.writingTime,
                    startDate: draft.startDate,
                    brief: draft.brief,
                  },
                  dates: (x.dates || []).map((d: any) => ({
                    id: d.id,
                    title: d.title,
                    date: d.date,
                  })),
                  plan: plan
                    ? {
                        date: plan.date,
                        simulated: Boolean(plan.simulated),
                        model: plan.model,
                        sections: Array.isArray(plan.sections)
                          ? plan.sections.length
                          : 0,
                        data: plan,
                      }
                    : null,
                };
              })}
              ready={ready}
              save={saveDraft}
              add={newMaterial}
              open={(m) => edit("material", m)}
              createProject={() => project()}
              deleteProject={deleteProject}
              selectProject={(id) => {
                if (view === "Organiser mon manuscrit") {
                  try {
                    if (!sessionStorage.getItem("manuscrit-research-resume")) {
                      keepCorpusStartFlow();
                    }
                  } catch {
                    keepCorpusStartFlow();
                  }
                }
                setPid(id);
              }}
              go={(page) => go(page)}
            />
          ) : isLegalPage(view) ? (
            <LegalPage page={view} />
          ) : view === "Abonnement" ? (
            <Subscriptions />
          ) : view === "Tableau de bord" ? (
            <>
              <section className="hero">
                <div className="heroin">
                  <div className="eyebrow">
                    <Bookmark size={12} /> PROJET ACTIF{" "}
                    {p.demo && <span className="demo">Exemple</span>}
                  </div>
                  <h2>{p.title}</h2>
                  <div className="herometa">
                    <i className="fa-solid fa-graduation-cap" aria-hidden="true" />
                    {projectTypeLabel(p)}
                    <span>·</span>
                    {cs.length} chapitres
                  </div>
                  <div className="heroprog">
                    <div>
                      <span>Avancement global</span>
                      <b className={"prog-" + progressTone(pct)}>{pct} %</b>
                    </div>
                    <div className={"bar " + progressTone(pct)}>
                      <i style={{ width: pct + "%" }} />
                    </div>
                  </div>
                </div>
                <Book />
              </section>
              <div className="metrics">
                {metric.map(([I, n, v, sub, target]: any, i: number) => (
                  <button key={n} className="metric" onClick={() => go(target)}>
                    <div>
                      <span className={"ico " + colors[i]}>
                        <I size={20} />
                      </span>
                      <ArrowUpRight size={14} />
                    </div>
                    <b>{v}</b>
                    <strong>{n}</strong>
                    <small>{sub}</small>
                  </button>
                ))}
              </div>
              <div className="dashgrid">
                <section className="panel">
                  {panelTitle("Avancement par chapitre", "Rédaction", () =>
                    go("Rédaction"),
                  )}
                  {chRows()}
                </section>
                <section className="panel">
                  {panelTitle("Échéances", "Tout voir", () => go("Échéances"))}
                  {dates.slice(0, 3).map(dateRow)}
                  {!dates.length && blank("Aucune échéance prévue.")}
                  <button className="addline" onClick={() => edit("date")}>
                    <Plus size={15} /> Ajouter une échéance
                  </button>
                </section>
              </div>
              <section className="panel lower">
                {panelTitle("Points à vérifier", "Tout voir", () =>
                  go("Points à vérifier"),
                )}
                {pending.slice(0, 3).map((x: any) => (
                  <button
                    className="listrow"
                    key={x.id}
                    onClick={() => edit("task", x)}
                  >
                    <Flag size={16} />
                    {x.title}
                    <span className="pill">{x.status}</span>
                  </button>
                ))}
                {!pending.length && blank("Tous les points sont traités.")}
              </section>
            </>
          ) : (
            <>
              <p className="context">
                <BookMarked size={16} />
                {p.title}
                {p.demo && <span className="demo">Exemple</span>}
              </p>
              {view === "Rédaction" && (
                <section className="panel">
                  {panelTitle(
                    "Plan détaillé",
                    "Ajouter un chapitre",
                    newAction,
                  )}
                  {chRows()}
                </section>
              )}
              {view === "Matériaux" && (
                <>
                  <div className="filters">
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Rechercher un matériau"
                        placeholder="Rechercher un matériau…"
                        value={search}
                        onChange={(e) => S(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Type"
                      value={filter.type || ""}
                      onChange={(e) => K({ ...filter, type: e.target.value })}
                    >
                      <option value="">Type</option>
                      {Array.from(
                        new Set<string>(
                          p.materials.map((x: any) => x.type).filter(Boolean),
                        ),
                      ).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <section className="panel">
                    {p.materials
                      .filter(
                        (x: any) =>
                          x.title
                            .toLowerCase()
                            .includes(search.toLowerCase()) &&
                          (!filter.type || x.type === filter.type),
                      )
                      .map((x: any) => (
                        <button
                          className="listrow"
                          key={x.id}
                          onClick={() => edit("material", x)}
                        >
                          <span className="ico teal">
                            <FileText size={18} />
                          </span>
                          <span>
                            <span className="material-code-badge">
                              {materialCode(x)}
                            </span>{" "}
                            {x.title}
                            <small>
                              Outil :{" "}
                              {isNoTool(x.toolType)
                                ? "Aucun"
                                : x.toolType || "—"}
                              {!isNoTool(x.toolType) && x.toolUnavailable
                                ? " (indisponible)"
                                : ""}
                              {" · "}
                              Données : {x.type || "—"}
                            </small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    {!p.materials.some(
                      (x: any) =>
                        x.title.toLowerCase().includes(search.toLowerCase()) &&
                        (!filter.type || x.type === filter.type),
                    ) && blank("Aucun matériau correspondant.")}
                  </section>
                </>
              )}
              {[
                "Points à vérifier",
                "Commentaires",
                "Échéances",
                "Versions",
              ].includes(view) && (
                <section className="panel">
                  {view === "Échéances"
                    ? dates.map(dateRow)
                    : (view === "Versions"
                        ? p.versions
                        : view === "Commentaires"
                          ? p.comments
                          : p.tasks
                      ).map((x: any) => (
                        <button
                          className="listrow"
                          key={x.id}
                          onClick={() =>
                            edit(
                              view === "Versions"
                                ? "version"
                                : view === "Commentaires"
                                  ? "comment"
                                  : "task",
                              x,
                            )
                          }
                        >
                          <span className="ico slate">
                            {view === "Versions" ? (
                              <History size={17} />
                            ) : view === "Commentaires" ? (
                              <MessageSquare size={17} />
                            ) : (
                              <Flag size={17} />
                            )}
                          </span>
                          <span>
                            {x.title}
                            <small>
                              {x.time
                                ? new Date(x.time).toLocaleString("fr-FR")
                                : chap(x.chapter)}
                            </small>
                          </span>
                          <span className="pill">{x.action || x.status}</span>
                        </button>
                      ))}
                  {!(
                    view === "Versions"
                      ? p.versions
                      : view === "Commentaires"
                        ? p.comments
                        : view === "Échéances"
                          ? dates
                          : p.tasks
                  ).length &&
                    blank(
                      view === "Versions"
                        ? "Les versions apparaîtront après le premier enregistrement."
                        : "Aucun élément pour ce projet.",
                    )}
                </section>
              )}
              {view === "Modèles" && (
                <div className="templates">
                  {Object.entries(templates).map(([n, sections], i) => (
                    <div className="panel" key={n}>
                      <span className={"ico " + colors[i]}>
                        <LibraryBig size={22} />
                      </span>
                      <h2>{n}</h2>
                      <ol>
                        {sections.map((v) => (
                          <li key={v}>{v}</li>
                        ))}
                      </ol>
                      <button className="textbtn" onClick={() => project(n)}>
                        Utiliser ce modèle <ArrowRight size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ))}
        </div>
        <footer className="site-footer">
          <div className="site-footer-inner">
            <nav aria-label="Informations légales">
              {legalPages.map((label) => (
                <button
                  key={label}
                  type="button"
                  className={view === label ? "active" : ""}
                  onClick={() => go(label)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <p className="site-footer-copy">
              © {new Date().getFullYear()} DataSensia · Manuscrit
            </p>
          </div>
        </footer>
      </main>
      {modal && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) M("");
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={titles[modal]}
          >
            <div className="dialoghead">
              <h2>{titles[modal]}</h2>
              <button aria-label="Fermer" disabled={busy} onClick={() => M("")}>
                <X size={20} />
              </button>
            </div>
            {modal === "projects" ? (
              <>
                <div className="projectlist">
                  {data.projects
                    .filter((x: any) => !x.demo)
                    .map((x: any) => (
                      <button
                        className="listrow"
                        key={x.id}
                        onClick={() => {
                          setPid(x.id);
                          go("Tableau de bord");
                        }}
                      >
                        <BookOpen size={18} />
                        <span>
                          {x.title}
                          <small>{projectTypeLabel(x)}</small>
                        </span>
                        {x.id === p.id && <Check size={16} />}
                      </button>
                    ))}
                  {!data.projects.some((x: any) => !x.demo) && (
                    <p>Aucun projet personnel pour le moment.</p>
                  )}
                </div>
                <button className="primary" onClick={() => project()}>
                  <Plus size={16} />
                  Nouveau projet
                </button>
              </>
            ) : modal === "version" ? (
              <>
                <p>
                  {form.action} · {new Date(form.time).toLocaleString("fr-FR")}
                </p>
                {[
                  ["Après modification", form.after],
                  ["Avant modification", form.before],
                ]
                  .filter((a) => a[1])
                  .map(([label, snap]: any) => (
                    <details key={label} open>
                      <summary>{label}</summary>
                      <Snapshot item={snap} p={p} />
                    </details>
                  ))}
              </>
            ) : (
              <form onSubmit={save}>
                {modal !== "material" &&
                  field(
                    modal === "project" ? "Titre du projet" : "Intitulé",
                    "title",
                    undefined,
                    true,
                  )}
                {modal === "project" && (
                  <>
                    <label className="field-select">
                      Type de projet
                      <TopicSelect
                        value={form.type || ""}
                        onChange={(value) => {
                          val("type", value);
                          if (value !== "Autre") val("typeOther", "");
                        }}
                        placeholder="Choisir un type…"
                        allowEmpty={false}
                        options={[...PROJECT_MODEL_OPTIONS]}
                        aria-label="Type de projet"
                      />
                    </label>
                    {form.type === "Autre" && (
                      <label>
                        Précisez le type de projet
                        <input
                          required
                          maxLength={120}
                          value={form.typeOther || ""}
                          placeholder="Ex. rapport de stage, dossier de recherche…"
                          onChange={(e) => val("typeOther", e.target.value)}
                        />
                      </label>
                    )}
                  </>
                )}
                {modal === "material" && (
                  <>
                    <label>
                      Intitulé
                      <div className="material-title-with-code">
                        <input
                          required
                          value={form.title || ""}
                          onChange={(e) => val("title", e.target.value)}
                          placeholder="Ex. Entretien E03 — usages numériques"
                        />
                        {form.id && form.type && (
                          <span
                            className="material-code-badge"
                            title="Code à citer dans le plan de rédaction"
                          >
                            {materialCode(form)}
                          </span>
                        )}
                      </div>
                    </label>

                    <div className="material-dual-block">
                      <label className="field-select">
                        Outil de recueil
                        <TopicSelect
                          value={form.toolType || ""}
                          onChange={(value) => {
                            val("toolType", value);
                            if (isNoTool(value)) {
                              val("toolUnavailable", false);
                              setToolFile(null);
                            }
                          }}
                          placeholder="Choisir l’outil…"
                          allowEmpty={false}
                          options={[
                            ...(form.toolType &&
                            !TOOL_TYPE_OPTIONS.some(
                              (o) => o.value === form.toolType,
                            )
                              ? [
                                  {
                                    value: form.toolType,
                                    label: form.toolType,
                                  },
                                ]
                              : []),
                            ...TOOL_TYPE_OPTIONS,
                          ]}
                          aria-label="Outil de recueil"
                        />
                      </label>
                      {isNoTool(form.toolType) ? (
                        <p className="material-kind-hint">
                          Aucun outil associé à cette fiche.
                        </p>
                      ) : (
                        <>
                          <p className="material-kind-hint">
                            Joignez le fichier de l’outil, ou déclarez-le
                            indisponible.
                          </p>
                          <label className="inline-check material-tool-unavailable">
                            <input
                              type="checkbox"
                              checked={Boolean(form.toolUnavailable)}
                              onChange={(e) => {
                                val("toolUnavailable", e.target.checked);
                                if (e.target.checked) setToolFile(null);
                              }}
                            />{" "}
                            Outil indisponible (non joint)
                          </label>
                          {!form.toolUnavailable && (
                            <>
                              {form.toolFile && (
                                <a
                                  className="material-file-link"
                                  href={
                                    "/api/workspace?file=" + form.toolFile
                                  }
                                >
                                  <Download size={15} /> {form.toolFilename}
                                </a>
                              )}
                              <label className="material-upload">
                                <span className="material-upload-btn">
                                  <Files size={16} />
                                  {toolFile || form.toolFilename
                                    ? "Remplacer l’outil"
                                    : "Joindre l’outil"}
                                </span>
                                <span className="material-upload-meta">
                                  {toolFile
                                    ? toolFile.name
                                    : "Word, PDF ou image · 20 Mo max"}
                                </span>
                                <input
                                  type="file"
                                  accept=".pdf,.doc,.docx,.txt,.md,.csv,.tsv,.xlsx,.png,.jpg,.jpeg,.webp,.gif"
                                  onChange={(e) => {
                                    setToolFile(e.target.files?.[0] || null);
                                    if (e.target.files?.[0])
                                      val("toolUnavailable", false);
                                  }}
                                />
                              </label>
                            </>
                          )}
                        </>
                      )}
                    </div>

                    <div className="material-dual-block">
                      <label className="field-select">
                        Données recueillies
                        <TopicSelect
                          value={form.type || ""}
                          onChange={(value) => val("type", value)}
                          placeholder="Choisir les données…"
                          allowEmpty={false}
                          options={[
                            ...(form.type &&
                            !DATA_TYPE_OPTIONS.some(
                              (o) => o.value === form.type,
                            )
                              ? [{ value: form.type, label: form.type }]
                              : []),
                            ...DATA_TYPE_OPTIONS,
                          ]}
                          aria-label="Données recueillies"
                        />
                      </label>
                      <p className="material-kind-hint">
                        Fichier obligatoire : entretien, réponses, notes,
                        archives…
                      </p>
                      {form.file && (
                        <a
                          className="material-file-link"
                          href={"/api/workspace?file=" + form.file}
                        >
                          <Download size={15} /> {form.filename}
                        </a>
                      )}
                      <label className="material-upload">
                        <span className="material-upload-btn">
                          <Files size={16} />
                          {file || form.filename
                            ? "Remplacer les données"
                            : "Joindre les données"}
                        </span>
                        <span className="material-upload-meta">
                          {file
                            ? file.name
                            : "Fichier obligatoire · Word, PDF ou image · 20 Mo max"}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.txt,.md,.csv,.tsv,.xlsx,.png,.jpg,.jpeg,.webp,.gif"
                          onChange={(e) => H(e.target.files?.[0] || null)}
                        />
                      </label>
                      {form.extracted && (
                        <details>
                          <summary>Texte extrait des données</summary>
                          <pre className="source-passage">
                            {form.extracted}
                          </pre>
                        </details>
                      )}
                      {form.toolExtracted && !form.toolUnavailable && (
                        <details>
                          <summary>Texte extrait de l’outil</summary>
                          <pre className="source-passage">
                            {form.toolExtracted}
                          </pre>
                        </details>
                      )}
                    </div>

                    {field(
                      "Observation",
                      "observation",
                      undefined,
                      false,
                      "area",
                      "Contexte, précisions ou points saillants…",
                    )}
                    <Attestation checked={attested} onChange={attest} />
                  </>
                )}
                {modal === "chapter" && (
                  <>
                    <label>
                      Avancement du chapitre · {form.progress} %
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={form.progress}
                        onChange={(e) => val("progress", +e.target.value)}
                      />
                    </label>
                    {field(
                      "Plan détaillé du chapitre",
                      "text",
                      undefined,
                      false,
                      "area",
                    )}
                    <fieldset>
                      <legend>Matériaux mobilisés</legend>
                      {p.materials.length
                        ? p.materials.map((x: any) => (
                            <label className="check" key={x.id}>
                              <input
                                type="checkbox"
                                checked={(form.links || []).includes(x.id)}
                                onChange={(e) =>
                                  val(
                                    "links",
                                    e.target.checked
                                      ? [...(form.links || []), x.id]
                                      : form.links.filter(
                                          (z: string) => z !== x.id,
                                        ),
                                  )
                                }
                              />
                              {x.title}
                            </label>
                          ))
                        : "Aucun matériau enregistré."}
                    </fieldset>
                    {(form.sections || []).map((x: any, i: number) => {
                      const update = (k: string, v: string) =>
                        val(
                          "sections",
                          form.sections.map((a: any, j: number) =>
                            i === j ? { ...a, [k]: v } : a,
                          ),
                        );
                      return (
                        <fieldset key={i}>
                          <legend>Section {i + 1}</legend>
                          <label>
                            Type
                            <select
                              value={x.kind}
                              onChange={(e) => update("kind", e.target.value)}
                            >
                              {[
                                "Problématique",
                                "Plan détaillé",
                                "Section rédigée",
                                "Tableau",
                                "Analyse",
                                "Conclusion",
                              ].map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Titre
                            <input
                              value={x.title}
                              onChange={(e) => update("title", e.target.value)}
                            />
                          </label>
                          <label>
                            {x.kind === "Tableau"
                              ? "Tableau (séparer les colonnes par une tabulation)"
                              : "Texte"}
                            <textarea
                              rows={6}
                              value={x.text}
                              onChange={(e) => update("text", e.target.value)}
                            />
                          </label>
                          {x.kind === "Tableau" && x.text && (
                            <div className="tablewrap">
                              <table>
                                <tbody>
                                  {x.text
                                    .split("\n")
                                    .map((row: string, j: number) => (
                                      <tr key={j}>
                                        {row
                                          .split("\t")
                                          .map((c: string, z: number) => (
                                            <td key={z}>{c}</td>
                                          ))}
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </fieldset>
                      );
                    })}
                    <button
                      className="secondary"
                      type="button"
                      onClick={() =>
                        val("sections", [
                          ...(form.sections || []),
                          { kind: "Section rédigée", title: "", text: "" },
                        ])
                      }
                    >
                      <Plus size={15} />
                      Ajouter une section
                    </button>
                  </>
                )}
                {["task", "date", "comment"].includes(modal) && (
                  <>
                    {chapterField()}
                    {modal === "date" ? (
                      field("Date prévue", "date", undefined, true, "date")
                    ) : modal === "task" ? (
                      field(
                        "Statut",
                        "status",
                        ["À vérifier", "À compléter", "Résolu"],
                        true,
                      )
                    ) : (
                      <>
                        {field(
                          "Nature de la demande",
                          "type",
                          ["Commentaire", "Demande de correction"],
                          true,
                        )}
                        {field(
                          "Statut",
                          "status",
                          ["Ouvert", "En cours", "Résolu"],
                          true,
                        )}
                      </>
                    )}
                    {field("Détails", "text", undefined, false, "area")}
                  </>
                )}
                {err && <p role="alert">{err}</p>}
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => M("")}
                  >
                    Annuler
                  </button>
                  <button
                    className="primary"
                    disabled={!ready || busy || !formSaveReady}
                  >
                    {busy
                      ? "Enregistrement…"
                      : modal === "project"
                        ? "Créer le projet"
                        : "Enregistrer"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function Snapshot({ item, p }: any) {
  const labels: any = {
    title: "Intitulé",
    progress: "Avancement (%)",
    text: "Contenu",
    source: "Source",
    type: "Type",
    theme: "Thème",
    chapter: "Chapitre",
    status: "Statut",
    date: "Date",
    filename: "Document",
    links: "Matériaux",
    sections: "Sections",
  };
  return (
    <dl>
      {Object.entries(item)
        .filter(
          ([k, v]) => labels[k] && v !== "" && (!Array.isArray(v) || v.length),
        )
        .map(([k, v]: any) => (
          <div key={k}>
            <dt>{labels[k]}</dt>
            <dd>
              {k === "chapter"
                ? p.chapters.find((x: any) => x.id === v)?.title
                : k === "sections"
                  ? v
                      .map((s: any) => [s.kind, s.title, s.text].join("\n"))
                      .join("\n\n")
                  : k === "links"
                    ? v
                        .map(
                          (id: string) =>
                            p.materials.find((m: any) => m.id === id)?.title,
                        )
                        .join(", ")
                    : String(v)}
            </dd>
          </div>
        ))}
      {Object.entries(item.extra || {}).map(([k, v]: any) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
