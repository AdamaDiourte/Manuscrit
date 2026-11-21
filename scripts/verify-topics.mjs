/**
 * Vérification live A/B/C + document B (jobs progressifs).
 * Écrit dans .data/verify-out/<date-heure>/ et latest/.
 * VERIFY_ONLY=B pour un seul profil.
 */
import { mkdir, writeFile } from "node:fs/promises";
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

const profiles = {
  A: {
    project_type: "m2",
    discipline_main: "sociologie",
    topic_freedom: "free",
    deadline_range: "3to6m",
    expected_length: "medium",
    weekly_time: "5to10",
    writing_language: "fr",
  },
  B: {
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
  },
  C: {
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
  },
};

function stampDir() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function startGenerate(answers, effort) {
  const res = await fetch(`${BASE}/api/topics/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({
      answers,
      consents: consents(),
      ...(effort ? { effort } : {}),
    }),
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
  let firstReadyMs = null;
  let lastReadyMs = null;
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
        const elapsed = Date.now() - t0;
        if (firstReadyMs == null) firstReadyMs = elapsed;
        lastReadyMs = elapsed;
        console.error(`  axis ${axis} ready at ${elapsed}ms`);
      }
    }
    if (job.status === "error")
      throw new Error(`job failed ${job.error_code || ""}`);
    if (job.status === "done" && job.ticket) {
      return {
        ...job,
        client_first_ready_ms: firstReadyMs,
        client_last_ready_ms: lastReadyMs,
        client_total_ms: Date.now() - t0,
      };
    }
  }
}

async function fetchReadings(ticket, axis, answers) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/topics/readings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({
      ticket,
      axis,
      answers,
      consents: consents(),
    }),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      `readings HTTP ${res.status} ${data.error || JSON.stringify(data)}`,
    );
  return {
    readings: data.readings || [],
    rejectedCount: data.rejectedCount ?? 0,
    sources_status: data.sources_status || null,
    literature_density: data.literature_density || null,
    latency_ms: Date.now() - t0,
  };
}

async function document(ticket, axis, answers, kind = "research_project") {
  const res = await fetch(`${BASE}/api/topics/document`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({
      kind,
      ticket,
      topic: {
        axis,
        title: "SUJET CLIENT FORGE — NE PAS UTILISER",
        research_question: "Question forgée côté client ?",
      },
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

function countBySource(readings) {
  const out = { openalex: 0, hal: 0 };
  for (const r of readings || []) {
    if (r.source === "openalex") out.openalex += 1;
    else if (r.source === "hal") out.hal += 1;
  }
  return out;
}

async function writeBoth(runDir, latestDir, name, data) {
  const json = JSON.stringify(data, null, 2);
  await writeFile(join(runDir, name), json, "utf8");
  await writeFile(join(latestDir, name), json, "utf8");
}

async function runProfile(name, effort) {
  console.error(
    `Generating profile ${name}${effort ? ` effort=${effort}` : ""}…`,
  );
  const started = await startGenerate(profiles[name], effort);
  const job = await pollJob(started.job_id);
  const topics = ["mastery", "ambition", "discovery"]
    .map((a) => job.axes?.[a]?.topic)
    .filter(Boolean);

  console.error(
    `  topics ok first=${job.first_ready_ms ?? job.client_first_ready_ms}ms last=${job.last_ready_ms ?? job.client_last_ready_ms}ms total=${job.latency_ms ?? job.client_total_ms}ms review=${job.review_status}`,
  );

  const readingsByAxis = {};
  let readingsLatency = 0;
  const skipReadings = process.env.VERIFY_SKIP_READINGS === "1";
  if (!skipReadings) {
    await Promise.all(
      topics.map(async (t) => {
        const r = await fetchReadings(job.ticket, t.axis, profiles[name]);
        readingsByAxis[t.axis] = r;
        readingsLatency = Math.max(readingsLatency, r.latency_ms);
        t.readings = r.readings;
        t.literature_density = r.literature_density;
        t.sources_status = r.sources_status;
      }),
    );
  } else {
    for (const t of topics) {
      t.readings = [];
    }
  }

  return {
    profile: name,
    effort: effort || "low",
    model: job.model,
    simulated: job.simulated,
    personalization_level: job.personalization_level,
    review_status: job.review_status,
    review_issues_first: job.review_issues_first || [],
    blocking_corrections: job.blocking_corrections || [],
    angle_plan: job.angle_plan || null,
    axes_meta: job.axes_meta || null,
    timing_shared: job.timing_shared || null,
    timing_by_axis: Object.fromEntries(
      ["mastery", "ambition", "discovery"].map((axis) => {
        const meta = job.axes_meta?.[axis] || {};
        const t = meta.timing || {};
        return [
          axis,
          {
            angle_plan_ms: job.timing_shared?.angle_plan_ms ?? null,
            generate_ms: t.generate_ms ?? null,
            quality_check_ms: t.quality_check_ms ?? null,
            review_ms: t.review_ms ?? null,
            correction_ms: t.correction_ms ?? null,
            cross_review_ms: job.timing_shared?.cross_review_ms ?? null,
          },
        ];
      }),
    ),
    warnings_by_axis: Object.fromEntries(
      topics.map((t) => [
        t.axis,
        (t.warnings || []).map((w) => ({ code: w.code, message: w.message })),
      ]),
    ),
    first_ready_ms: job.first_ready_ms ?? job.client_first_ready_ms,
    last_ready_ms: job.last_ready_ms ?? job.client_last_ready_ms,
    latency_topics_ms: job.latency_ms ?? job.client_total_ms,
    latency_readings_ms: readingsLatency,
    tokens_in: job.tokens_in,
    tokens_out: job.tokens_out,
    tokens_thinking: job.tokens_thinking,
    readings_by_axis: Object.fromEntries(
      Object.entries(readingsByAxis).map(([axis, r]) => [
        axis,
        {
          count: r.readings.length,
          rejectedCount: r.rejectedCount,
          latency_ms: r.latency_ms,
          sources_status: r.sources_status,
          literature_density: r.literature_density,
          by_source: countBySource(r.readings),
        },
      ]),
    ),
    titles: topics.map((t) => ({ axis: t.axis, title: t.title })),
    topics,
    ticket: job.ticket,
  };
}

const rootOut = join(process.cwd(), ".data", "verify-out");
const runDir = join(rootOut, stampDir());
const latestDir = join(rootOut, "latest");
await mkdir(runDir, { recursive: true });
await mkdir(latestDir, { recursive: true });

const only = (process.env.VERIFY_ONLY || "A,B,C")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const report = {};

for (const name of only) {
  if (!profiles[name]) {
    console.error(`Unknown profile ${name}, skip`);
    continue;
  }
  const summary = await runProfile(name);
  report[name] = summary;
  await writeBoth(runDir, latestDir, `profile-${name}.json`, summary);
  await writeBoth(runDir, latestDir, `topics-${name}.json`, summary.topics);
}

if (only.includes("B") && report.B && process.env.VERIFY_SKIP_DOCUMENT !== "1") {
  const mastery = report.B.topics.find((t) => t.axis === "mastery");
  console.error("Document B/mastery research_project…");
  const doc = await document(
    report.B.ticket,
    "mastery",
    profiles.B,
    "research_project",
  );
  const sections = doc.document?.sections || [];
  const problem = sections.find(
    (s) => s.id === "problem" || /problématique/i.test(s.heading || ""),
  );
  const design = sections.find(
    (s) =>
      s.id === "method" ||
      /design de recherche|dispositif méthodologique|démarche/i.test(
        s.heading || "",
      ),
  );
  const theory = sections.find(
    (s) =>
      s.id === "theory" ||
      s.id === "state" ||
      /cadre th|repères/i.test(s.heading || ""),
  );
  console.error("Document B/mastery work_plan…");
  const planDoc = await document(
    report.B.ticket,
    "mastery",
    profiles.B,
    "work_plan",
  );
  const planSections = planDoc.document?.sections || [];
  const schedule = planSections.find(
    (s) => s.id === "schedule" || /planning|calendrier/i.test(s.heading || ""),
  );
  await writeBoth(runDir, latestDir, "profile-B-document.json", {
    title: doc.document?.title,
    model: doc.model,
    simulated: doc.simulated,
    ticket_axis: "mastery",
    ticket_title: mastery?.title || null,
    client_forged_title_rejected:
      doc.document?.title !== "SUJET CLIENT FORGE — NE PAS UTILISER",
    problem,
    design,
    theory,
    work_plan_title: planDoc.document?.title || null,
    work_plan: planDoc.document?.workPlan || null,
    schedule,
    bibliography: doc.bibliography || null,
  });
}

console.error(`Done. run=${runDir}`);
