/**
 * Mission v3.10 : documents B mastery + sujets C (focus mastery).
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:3000";
const ORIGIN = "http://127.0.0.1:5173";
const NOTICE = "2026-11-v2";

function consents() {
  const at = new Date().toISOString();
  const rec = (value) => ({ value, at, noticeVersion: NOTICE });
  return {
    ageOver15: rec(true),
    noticeAccepted: rec(true),
    retainProfile: rec(false),
    serviceImprovement: rec(false),
  };
}

const profileBAnswers = {
  project_type: "m2",
  discipline_main: "sociologie",
  specialty: "sociologie de la culture",
  topic_freedom: "free",
  interest_objects:
    "la lecture chez les jeunes adultes, les bibliothèques municipales",
  field_access: "stage de 4 mois dans une médiathèque de banlieue",
  favorite_courses: "sociologie des pratiques culturelles",
  inspiring_concept: "la notion de légitimité culturelle",
  methods_skills: { interviews: 3, survey: 1 },
  method_to_learn: ["nlp"],
  software: ["r"],
  deadline_range: "6to12m",
  expected_length: "medium",
  weekly_time: "10to20",
  writing_language: "fr",
};

const profileCAnswers = {
  project_type: "thesis",
  discipline_main: "science_politique",
  topic_freedom: "imposed",
  imposed_by: "contrat doctoral du laboratoire",
  imposed_theme: "la participation électorale des jeunes",
  deadline_range: "gt3y",
  expected_length: "long",
  weekly_time: "fulltime",
  writing_language: "fr",
  methods_skills: { desc_stats: 2, infer_stats: 2 },
  software: ["r", "stata"],
};

function stampDir() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function document(ticket, answers, kind) {
  const res = await fetch(`${BASE}/api/topics/document`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({
      kind,
      ticket,
      topic: { axis: "mastery" },
      answers,
      consents: consents(),
    }),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      `document HTTP ${res.status} ${kind} ${data.error || JSON.stringify(data)}`,
    );
  return data;
}

async function startGenerate(answers) {
  const res = await fetch(`${BASE}/api/topics/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ answers, consents: consents() }),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      `generate HTTP ${res.status} ${data.error || JSON.stringify(data)}`,
    );
  return data;
}

async function pollJob(jobId) {
  const t0 = Date.now();
  const seen = new Set();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`${BASE}/api/topics/jobs/${jobId}`, {
      headers: { Origin: ORIGIN },
    });
    const job = await res.json();
    if (!res.ok)
      throw new Error(
        `job HTTP ${res.status} ${job.error || JSON.stringify(job)}`,
      );
    for (const axis of ["mastery", "ambition", "discovery"]) {
      if (job.axes?.[axis]?.status === "done" && !seen.has(axis)) {
        seen.add(axis);
        console.error(`  axis ${axis} ready at ${Date.now() - t0}ms`);
      }
    }
    if (job.status === "error")
      throw new Error(`job failed ${job.error_code || ""}`);
    if (job.status === "done" && job.ticket) return job;
  }
}

async function writeBoth(runDir, latestDir, name, data) {
  const json = JSON.stringify(data, null, 2);
  await writeFile(join(runDir, name), json, "utf8");
  await writeFile(join(latestDir, name), json, "utf8");
}

const rootOut = join(process.cwd(), ".data", "verify-out");
const runDir = join(rootOut, stampDir());
const latestDir = join(rootOut, "latest");
await mkdir(runDir, { recursive: true });
await mkdir(latestDir, { recursive: true });

const mode = process.argv[2] || "all";

if (mode === "docs" || mode === "all") {
  const profileB = JSON.parse(
    await readFile(join(latestDir, "profile-B.json"), "utf8"),
  );
  console.error("Document B/mastery research_project…");
  const research = await document(
    profileB.ticket,
    profileBAnswers,
    "research_project",
  );
  console.error(
    `  ok model=${research.model} simulated=${research.simulated}`,
  );
  console.error("Document B/mastery work_plan…");
  const plan = await document(profileB.ticket, profileBAnswers, "work_plan");
  console.error(`  ok model=${plan.model} simulated=${plan.simulated}`);

  const schedule = (plan.document?.sections || []).find(
    (s) => s.id === "schedule",
  );
  const docOut = {
    title: research.document?.title,
    model: research.model,
    simulated: research.simulated,
    work_plan_title: plan.document?.title || null,
    work_plan_model: plan.model,
    work_plan_simulated: plan.simulated,
    workPlan: plan.document?.workPlan || null,
    schedule,
  };
  await writeBoth(runDir, latestDir, "profile-B-document.json", docOut);
  await writeBoth(runDir, latestDir, "profile-B-mastery-plan.json", {
    work_plan: plan.document?.workPlan || null,
    table: schedule?.table || null,
  });
  console.error(
    JSON.stringify(
      {
        research_simulated: research.simulated,
        plan_simulated: plan.simulated,
        plan_model: plan.model,
        phases: (plan.document?.workPlan?.phases || []).map((p) => p.title),
      },
      null,
      2,
    ),
  );
}

if (mode === "C" || mode === "all") {
  console.error("Generating profile C…");
  const started = await startGenerate(profileCAnswers);
  const job = await pollJob(started.job_id);
  const topics = ["mastery", "ambition", "discovery"]
    .map((a) => job.axes?.[a]?.topic)
    .filter(Boolean);
  for (const t of topics) t.readings = [];

  const summary = {
    profile: "C",
    effort: "low",
    model: job.model,
    simulated: job.simulated,
    review_status: job.review_status,
    review_issues_first: job.review_issues_first || [],
    blocking_corrections: job.blocking_corrections || [],
    axes_meta: job.axes_meta || null,
    warnings_by_axis: Object.fromEntries(
      topics.map((t) => [
        t.axis,
        (t.warnings || []).map((w) => ({ code: w.code, message: w.message })),
      ]),
    ),
    ticket: job.ticket,
    topics,
  };
  await writeBoth(runDir, latestDir, "profile-C.json", summary);
  await writeBoth(runDir, latestDir, "topics-C.json", topics);

  const mastery = topics.find((t) => t.axis === "mastery");
  const discoveryB = JSON.parse(
    await readFile(join(latestDir, "topics-B.json"), "utf8"),
  ).find((t) => t.axis === "discovery");

  const mission = {
    B_mastery_docs: JSON.parse(
      await readFile(join(latestDir, "profile-B-document.json"), "utf8"),
    ),
    C_mastery: {
      title: mastery?.title,
      research_question: mastery?.research_question,
      violations_first: job.axes_meta?.mastery?.violations_first || [],
      violations_after: job.axes_meta?.mastery?.violations_after || [],
      warnings: mastery?.warnings || [],
    },
    B_discovery: {
      title: discoveryB?.title,
      research_question: discoveryB?.research_question,
      warnings: discoveryB?.warnings || [],
    },
  };
  await writeBoth(runDir, latestDir, "mission-v310-summary.json", mission);
  console.error(
    JSON.stringify(
      {
        C_mastery_title: mastery?.title,
        C_mastery_question: mastery?.research_question,
        C_warnings: mastery?.warnings,
        B_discovery_title: discoveryB?.title,
        B_discovery_question: discoveryB?.research_question,
      },
      null,
      2,
    ),
  );
}

console.error(`Done. run=${runDir}`);
