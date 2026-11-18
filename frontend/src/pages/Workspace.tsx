
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
import { templates, types, makeProject, demo } from "../data/projectTemplates";
import ResearchStudio, {
  type ResearchPage,
} from "../components/copilot/ResearchStudio";
import { mergeTopicArchives } from "../components/topics/topicArchive";
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
  async function load() {
    try {
      const r = await fetch("/api/workspace", { cache: "no-store" });
      if (!r.ok) throw 1;
      const a = (await r.json()) as any;
      rev.current = a.rev;
      if (a.data) setData(a.data);
      R(true);
      L(false);
    } catch {
      L(true);
    }
  }
  useEffect(() => {
    load();
    if (new URLSearchParams(location.search).get("billing") === "return")
      V("Abonnement");
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
    F(structuredClone(f));
    M(m);
    O(false);
  }
  const val = (key: string, v: any) => F((f: any) => ({ ...f, [key]: v }));
  function newMaterial() {
    edit("material", { type: "Note", status: "À classer", extra: {} });
  }
  function project(type = "Mémoire") {
    edit("project", { type });
  }
  async function commit(next: any) {
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
        const n = makeProject(a.title.trim(), a.person.trim(), a.type);
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
          a.attestedAt = new Date().toISOString();
        }
        if (file) {
          if (file.size > 20 * 1024 * 1024)
            throw Error("Le fichier dépasse 20 Mo.");
          if (/\.(txt|md|csv|tsv|pdf|docx|xlsx)$/i.test(file.name)) {
            const { extractText } = await import("../services/import/extractText");
            try {
              a.extracted = await extractText(file);
            } catch (ex) {
              if (!a.text?.trim()) throw ex;
              a.extracted = "";
            }
          } else {
            a.extracted = "";
            if (!a.text?.trim())
              throw Error(
                "Décrivez ce document ou ajoutez une transcription dans Notes et contenu.",
              );
          }
          const r = await fetch(
            "/api/workspace?upload=1&name=" + encodeURIComponent(file.name),
            {
              method: "POST",
              headers: { "X-Deposit-Attested": "yes" },
              body: file,
            },
          );
          if (!r.ok) throw Error("Le dépôt du fichier a échoué.");
          a.file = ((await r.json()) as { id: string }).id;
          a.filename = file.name;
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
        setPid(newId);
        go("Accueil");
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
          />
        ) : (
          <input
            required={required}
            type={type}
            value={form[key] || ""}
            onChange={(e) => val(key, e.target.value)}
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
          {!isResearchPage(view) && (
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
          {loadErr && (
            <p role="alert">
              Chargement du projet impossible.{" "}
              <button onClick={load}>Réessayer</button>
            </p>
          )}
          {isResearchPage(view) ? (
            <ResearchStudio
              key={view + p.id + String(ready)}
              page={view}
              p={p}
              ready={ready}
              save={saveDraft}
              add={newMaterial}
              open={(m) => edit("material", m)}
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
                    {p.type}
                    {p.person && " · " + p.person}
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
                    {[
                      ["type", "Type"],
                      ["theme", "Thème"],
                      ["chapter", "Chapitre"],
                      ["source", "Source"],
                      ["status", "Statut"],
                    ].map(([k, l]) => (
                      <select
                        aria-label={l}
                        key={k}
                        value={filter[k] || ""}
                        onChange={(e) => K({ ...filter, [k]: e.target.value })}
                      >
                        <option value="">{l}</option>
                        {Array.from(
                          new Set<string>(
                            p.materials.map((x: any) => x[k]).filter(Boolean),
                          ),
                        ).map((v) => (
                          <option key={v} value={v}>
                            {k === "chapter" ? chap(v) : v}
                          </option>
                        ))}
                      </select>
                    ))}
                  </div>
                  <section className="panel">
                    {p.materials
                      .filter(
                        (x: any) =>
                          x.title
                            .toLowerCase()
                            .includes(search.toLowerCase()) &&
                          Object.entries(filter).every(
                            ([k, v]) => !v || x[k] === v,
                          ),
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
                            {x.title}
                            <small>
                              {materialCode(x)} · {x.type} · {chap(x.chapter)}
                            </small>
                          </span>
                          <span className="pill">{x.status}</span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    {!p.materials.some(
                      (x: any) =>
                        x.title.toLowerCase().includes(search.toLowerCase()) &&
                        Object.entries(filter).every(
                          ([k, v]) => !v || x[k] === v,
                        ),
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
          )}
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
                          <small>
                            {[x.type, x.person].filter(Boolean).join(" · ")}
                          </small>
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
                {field(
                  modal === "project" ? "Titre du projet" : "Intitulé",
                  "title",
                  undefined,
                  true,
                )}
                {modal === "project" && (
                  <>
                    {field("Personne accompagnée", "person", undefined, true)}
                    {field(
                      "Modèle du projet",
                      "type",
                      Object.keys(templates),
                      true,
                    )}
                  </>
                )}
                {modal === "material" && (
                  <>
                    {field(
                      "Type de matériau",
                      "type",
                      Object.keys(types),
                      true,
                    )}
                    <div className="pair">
                      {field("Thème", "theme")}
                      {field("Source", "source")}
                    </div>
                    {chapterField()}
                    {field(
                      "Statut",
                      "status",
                      ["À classer", "Classé", "À vérifier", "Validé"],
                      true,
                    )}
                    {(types[form.type] || []).map((k) => (
                      <label key={k}>
                        {k}
                        <input
                          value={form.extra?.[k] || ""}
                          onChange={(e) =>
                            val("extra", { ...form.extra, [k]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                    {field(
                      "Notes et contenu",
                      "text",
                      undefined,
                      false,
                      "area",
                    )}
                    {form.extracted && (
                      <details>
                        <summary>Texte extrait du fichier</summary>
                        <pre className="source-passage">{form.extracted}</pre>
                      </details>
                    )}
                    {form.file && (
                      <a href={"/api/workspace?file=" + form.file}>
                        <Download size={15} /> {form.filename}
                      </a>
                    )}
                    <label>
                      Document joint (20 Mo maximum, transcription requise pour
                      les images et scans)
                      <input
                        type="file"
                        onChange={(e) => H(e.target.files?.[0] || null)}
                      />
                    </label>
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
                  <button className="primary" disabled={!ready || busy}>
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
