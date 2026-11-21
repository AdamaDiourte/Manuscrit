/**
 * Mission v3.11 : DOCX B mastery (PK, taille, unzip), noms, planning.
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

function stampDir() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function decodeBase64(b64) {
  const raw = String(b64 || "").replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(raw, "base64");
}

/** Minimal ZIP central-directory listing (no external unzip). */
function zipHasEntry(buf, wanted) {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return false;
  // Scan local file headers
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4b) break;
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x04034b50) {
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const comp = buf.readUInt16LE(offset + 8);
      const compSize = buf.readUInt32LE(offset + 18);
      const name = buf
        .subarray(offset + 30, offset + 30 + nameLen)
        .toString("utf8");
      if (name === wanted || name.endsWith(wanted)) return true;
      offset += 30 + nameLen + extraLen + (comp === 0 ? compSize : compSize);
      continue;
    }
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    break;
  }
  // Fallback: string search in uncompressed path names
  return buf.toString("binary").includes(wanted);
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

function inspectDocx(file) {
  const buf = decodeBase64(file.base64);
  const hasPk = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
  const hasDocumentXml = zipHasEntry(buf, "word/document.xml");
  return {
    filename: file.filename,
    mimeType: file.mimeType,
    bytes: buf.length,
    hasPk,
    hasDocumentXml,
    ok: hasPk && buf.length > 2048 && hasDocumentXml,
  };
}

function weeklyLoad(plan) {
  const maxWeek = Math.max(
    1,
    Math.ceil(plan.meta.totalWeeks) || 1,
    ...plan.phases.map((p) => p.weekEnd || 1),
  );
  const load = Array.from({ length: maxWeek + 1 }, () => 0);
  for (const phase of plan.phases) {
    const start = Math.max(1, phase.weekStart || 1);
    const end = Math.max(start, phase.weekEnd || start);
    const span = end - start + 1;
    const per = (Number(phase.hours) || 0) / span;
    for (let w = start; w <= end; w++) load[w] += per;
  }
  return load.map((h) => Math.round(h * 10) / 10);
}

async function main() {
  const runId = stampDir();
  const runDir = join(".data", "verify-out", runId);
  const latestDir = join(".data", "verify-out", "latest");
  await mkdir(runDir, { recursive: true });
  await mkdir(latestDir, { recursive: true });

  let ticket = process.env.VERIFY_TICKET || "";
  let mastery = null;
  if (!ticket) {
    try {
      const cached = JSON.parse(
        await readFile(join(latestDir, "profile-B.json"), "utf8"),
      );
      if (cached.ticket) {
        ticket = cached.ticket;
        mastery = (cached.topics || []).find((t) => t.axis === "mastery") || null;
        console.error("v3.11 reuse ticket from profile-B.json");
      }
    } catch {
      // regenerate below
    }
  }
  if (!ticket) {
    console.error("v3.11 generate B…");
    const started = await startGenerate(profileBAnswers);
    const job = await pollJob(started.job_id || started.jobId || started.id);
    const topics = ["mastery", "ambition", "discovery"]
      .map((a) => job.axes?.[a]?.topic)
      .filter(Boolean);
    mastery = topics.find((t) => t.axis === "mastery") || null;
    ticket = job.ticket;
    await writeFile(
      join(runDir, "profile-B.json"),
      JSON.stringify({ ticket, topics, model: job.model }, null, 2),
    );
    await writeFile(
      join(latestDir, "profile-B.json"),
      JSON.stringify({ ticket, topics, model: job.model }, null, 2),
    );
    await writeFile(join(latestDir, "topics-B.json"), JSON.stringify(topics, null, 2));
  }
  if (!mastery) {
    try {
      const topics = JSON.parse(
        await readFile(join(latestDir, "topics-B.json"), "utf8"),
      );
      mastery = topics.find((t) => t.axis === "mastery") || null;
    } catch {
      // ignore
    }
  }
  if (!mastery) throw new Error("mastery topic missing");
  if (!ticket) throw new Error("ticket missing");

  console.error("v3.11 documents mastery…");
  const project = await document(ticket, profileBAnswers, "research_project");
  const plan = await document(ticket, profileBAnswers, "work_plan");

  const projectInspect = inspectDocx(project.file);
  const planInspect = inspectDocx(plan.file);

  const workPlan = plan.document?.workPlan || null;
  const load = workPlan ? weeklyLoad(workPlan) : [];
  const peak = load.slice(1).reduce(
    (acc, h, i) => (h > acc.h ? { h, w: i + 1 } : acc),
    { h: 0, w: 1 },
  );
  const avg =
    load.slice(1).length > 0
      ? Math.round(
          (load.slice(1).reduce((a, b) => a + b, 0) / load.slice(1).length) *
            10,
        ) / 10
      : 0;

  const table = plan.document?.sections?.find((s) => s.id === "schedule")?.table;

  const summary = {
    at: new Date().toISOString(),
    mastery: {
      title: mastery.title,
      fieldwork_plan: mastery.fieldwork_plan,
      estimated_hours: mastery.estimated_hours,
    },
    files: {
      research_project: projectInspect,
      work_plan: planInspect,
    },
    redownload_strategy:
      "workspace fileId via GET /api/workspace?file= (durable after reload)",
    planning: workPlan
      ? {
          meta: workPlan.meta,
          phases: workPlan.phases.map((p) => ({
            title: p.title,
            role: p.role,
            weekStart: p.weekStart,
            weekEnd: p.weekEnd,
            hours: p.hours,
            objective: p.objective,
          })),
          weeklyLoad: load.slice(1),
          averageHoursPerWeek: avg,
          peakHoursPerWeek: peak.h,
          peakWeek: peak.w,
          budgetHoursPerWeek: workPlan.meta.hoursPerWeek,
          scheduleHeaders: table?.headers || [],
          scheduleRows: table?.rows || [],
        }
      : null,
  };

  const payload = JSON.stringify(summary, null, 2);
  await writeFile(join(runDir, "mission-v311-summary.json"), payload);
  await writeFile(join(latestDir, "mission-v311-summary.json"), payload);
  await writeFile(
    join(runDir, "profile-B-document.json"),
    JSON.stringify(
      {
        title: project.document?.title,
        filename: project.file?.filename,
        work_plan_title: plan.document?.title,
        work_plan_filename: plan.file?.filename,
        workPlan,
        fieldwork_plan: mastery.fieldwork_plan,
        estimated_hours: mastery.estimated_hours,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(latestDir, "profile-B-document.json"),
    await readFile(join(runDir, "profile-B-document.json"), "utf8"),
  );

  console.error(
    JSON.stringify(
      {
        project: projectInspect,
        plan: planInspect,
        fieldwork_plan: mastery.fieldwork_plan,
        estimated_hours: mastery.estimated_hours,
        peakHoursPerWeek: peak.h,
        budget: workPlan?.meta?.hoursPerWeek,
      },
      null,
      2,
    ),
  );
  if (!projectInspect.ok || !planInspect.ok) {
    process.exitCode = 1;
    console.error("DOCX validation failed");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
