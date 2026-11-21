import { useEffect, useMemo, useState } from "react";
import { NOTICE_VERSION } from "../../../../shared/research/notice";
import { normalizeTopicAnswers } from "../../../../shared/research/topicQuestions";
import { computeProfileCompleteness } from "../../../../shared/research/profileCompleteness";
import type {
  GeneratedTopic,
  RegenReason,
  TopicAxis,
  TopicConsents,
} from "../../../../shared/research/topicTypes";
import { detectSensitiveTerms } from "../../../../shared/privacy/sensitiveFilter";
import TopicNotice from "./TopicNotice";
import TopicQuestionnaire from "./TopicQuestionnaire";
import TopicReview from "./TopicReview";
import TopicEnrich from "./TopicEnrich";
import TopicResults, { type DocFile } from "./TopicResults";
import { useConfirmDialog } from "./ConfirmDialog";
import {
  clearDraft,
  loadDraft,
  makeConsent,
  saveDraft,
} from "./storage";

type Phase = "notice" | "quiz" | "review" | "enrich" | "results";

type Props = {
  goPrivacy: () => void;
  onTopicsGenerated?: (payload: {
    sessionId: string;
    topics: GeneratedTopic[];
    answers: Record<string, unknown>;
    model?: string;
    simulated?: boolean;
  }) => void | Promise<void>;
  onChooseTopic?: (
    topic: GeneratedTopic,
    docs: DocFile[],
    sessionId: string,
    answers: Record<string, unknown>,
  ) => void | Promise<void>;
};

export default function TopicGenerator({
  goPrivacy,
  onTopicsGenerated,
  onChooseTopic,
}: Props) {
  const saved = useMemo(() => loadDraft(), []);
  const [phase, setPhase] = useState<Phase>(
    saved?.consents?.noticeAccepted?.value ? "quiz" : "notice",
  );
  const [step, setStep] = useState(saved?.step || 1);
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const base = normalizeTopicAnswers({ ...(saved?.answers || {}) });
    if (!base.writing_language) base.writing_language = "fr";
    return base;
  });
  const [flags, setFlags] = useState({
    ageOver15: saved?.consents?.ageOver15?.value ?? false,
    noticeAccepted: saved?.consents?.noticeAccepted?.value ?? false,
    retainProfile: saved?.consents?.retainProfile?.value ?? false,
    serviceImprovement: saved?.consents?.serviceImprovement?.value ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [topics, setTopics] = useState<GeneratedTopic[]>([]);
  const [ticket, setTicket] = useState("");
  const [regens, setRegens] = useState(0);
  const [model, setModel] = useState("");
  const [simulate, setSimulate] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [personalizationLevel, setPersonalizationLevel] = useState<
    "high" | "medium" | "low" | undefined
  >(undefined);
  const [reviewStatus, setReviewStatus] = useState<"ok" | "failed" | undefined>(
    undefined,
  );
  const [axisStatus, setAxisStatus] = useState<
    Partial<Record<TopicAxis, "pending" | "done" | "error">>
  >({});
  const [sessionId, setSessionId] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  useEffect(() => {
    if (answers.writing_language) return;
    setAnswers((a) =>
      a.writing_language ? a : { ...a, writing_language: "fr" },
    );
  }, [answers.writing_language]);

  useEffect(() => {
    if (phase === "results") return;
    saveDraft({
      answers,
      step,
      noticeVersion: NOTICE_VERSION,
      updatedAt: new Date().toISOString(),
      consents: {
        ageOver15: makeConsent(flags.ageOver15),
        noticeAccepted: makeConsent(flags.noticeAccepted),
        retainProfile: makeConsent(flags.retainProfile),
        serviceImprovement: makeConsent(flags.serviceImprovement),
      },
    });
  }, [answers, step, flags, phase]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document
      .querySelector(".topic-flow, .topic-phase, .cp-flow")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [phase, step]);

  function buildConsents(): TopicConsents {
    return {
      ageOver15: makeConsent(flags.ageOver15),
      noticeAccepted: makeConsent(flags.noticeAccepted),
      retainProfile: makeConsent(flags.retainProfile),
      serviceImprovement: makeConsent(flags.serviceImprovement),
    };
  }

  async function confirmSensitive(): Promise<boolean> {
    const hits = Object.values(answers).flatMap((v) =>
      typeof v === "string" ? detectSensitiveTerms(v) : [],
    );
    if (!hits.length) return true;
    return confirm({
      title: "Information sensible détectée",
      message:
        "Certains textes semblent contenir une information sensible. Annuler pour revenir modifier, ou continuer pour valider malgré tout.",
      confirmLabel: "Continuer",
      cancelLabel: "Revenir modifier",
      danger: true,
    });
  }

  async function generate(fromEnrich = false) {
    setError("");
    if (!(await confirmSensitive())) return;

    if (!fromEnrich && computeProfileCompleteness(answers).level === "low") {
      setPhase("enrich");
      return;
    }

    setBusy(true);
    setTopics([]);
    setTicket("");
    setAxisStatus({
      mastery: "pending",
      ambition: "pending",
      discovery: "pending",
    });
    setPhase("results");
    try {
      const res = await fetch("/api/topics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          consents: buildConsents(),
          ...(simulate ? { simulate: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Génération impossible.");
      const jobId = data.job_id as string;
      if (!jobId) throw new Error("Identifiant de génération manquant.");

      const sid =
        sessionId ||
        "arch-" +
          Date.now().toString(36) +
          "-" +
          Math.random().toString(36).slice(2, 8);
      setSessionId(sid);
      clearDraft();

      let finalTopics: GeneratedTopic[] = [];
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const jr = await fetch(`/api/topics/jobs/${jobId}`);
        const job = await jr.json();
        if (!jr.ok) throw new Error(job.error || "Suivi de génération impossible.");

        const nextStatus: Partial<
          Record<TopicAxis, "pending" | "done" | "error">
        > = {};
        const collected: GeneratedTopic[] = [];
        for (const axis of ["mastery", "ambition", "discovery"] as TopicAxis[]) {
          const ax = job.axes?.[axis];
          nextStatus[axis] = ax?.status || "pending";
          if (ax?.status === "done" && ax.topic) {
            collected.push(ax.topic as GeneratedTopic);
          }
        }
        setAxisStatus(nextStatus);
        setTopics(collected);

        if (job.status === "error") {
          throw new Error("Génération interrompue.");
        }
        if (job.status === "done" && job.ticket) {
          finalTopics = collected;
          setTicket(job.ticket);
          setRegens(job.regenerationsRemaining ?? 0);
          setModel(job.model || "");
          setSimulated(Boolean(job.simulated));
          setPersonalizationLevel(
            job.personalization_level === "high" ||
              job.personalization_level === "medium" ||
              job.personalization_level === "low"
              ? job.personalization_level
              : undefined,
          );
          setReviewStatus(
            job.review_status === "failed" || job.review_status === "ok"
              ? job.review_status
              : "ok",
          );
          break;
        }
      }

      await onTopicsGenerated?.({
        sessionId: sid,
        topics: finalTopics,
        answers,
        model: model || "",
        simulated: Boolean(simulated),
      });
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Génération impossible.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(axis: TopicAxis, reason: RegenReason) {
    setError("");
    setBusy(true);
    setAxisStatus((prev) => ({ ...prev, [axis]: "pending" }));
    try {
      const res = await fetch("/api/topics/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket,
          axis,
          reason,
          answers,
          consents: buildConsents(),
          ...(simulate ? { simulate: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Régénération impossible.");
      const jobId = data.job_id as string;
      if (!jobId) throw new Error("Identifiant de régénération manquant.");

      let nextTopics: GeneratedTopic[] = [];
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const jr = await fetch(`/api/topics/jobs/${jobId}`);
        const job = await jr.json();
        if (!jr.ok)
          throw new Error(job.error || "Suivi de régénération impossible.");

        const nextStatus: Partial<
          Record<TopicAxis, "pending" | "done" | "error">
        > = {};
        const collected: GeneratedTopic[] = [];
        for (const a of ["mastery", "ambition", "discovery"] as TopicAxis[]) {
          const ax = job.axes?.[a];
          nextStatus[a] = ax?.status || "pending";
          if (ax?.status === "done" && ax.topic) {
            collected.push(ax.topic as GeneratedTopic);
          }
        }
        setAxisStatus(nextStatus);
        setTopics(collected);

        if (job.status === "error") {
          throw new Error("Régénération interrompue.");
        }
        if (job.status === "done" && job.ticket) {
          nextTopics = collected;
          setTicket(job.ticket);
          setRegens(job.regenerationsRemaining ?? 0);
          setModel(job.model || "");
          setSimulated(Boolean(job.simulated));
          if (
            job.personalization_level === "high" ||
            job.personalization_level === "medium" ||
            job.personalization_level === "low"
          ) {
            setPersonalizationLevel(job.personalization_level);
          }
          setReviewStatus(
            job.review_status === "failed" || job.review_status === "ok"
              ? job.review_status
              : "ok",
          );
          break;
        }
      }

      if (sessionId) {
        await onTopicsGenerated?.({
          sessionId,
          topics: nextTopics,
          answers,
          model: model || "",
          simulated: Boolean(simulated),
        });
      }
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Régénération impossible.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    const ok = await confirm({
      title: "Effacer les réponses",
      message: "Effacer toutes vos réponses locales ? Cette action est définitive.",
      confirmLabel: "Effacer",
      cancelLabel: "Annuler",
      danger: true,
    });
    if (!ok) return;
    clearDraft();
    setAnswers({ writing_language: "fr" });
    setStep(1);
    setTopics([]);
    setTicket("");
    setRegens(0);
    setSimulated(false);
    setReviewStatus(undefined);
    setError("");
    setPhase("notice");
    setFlags({
      ageOver15: false,
      noticeAccepted: false,
      retainProfile: false,
      serviceImprovement: false,
    });
  }

  function restart() {
    clearDraft();
    setTopics([]);
    setTicket("");
    setRegens(0);
    setSimulated(false);
    setReviewStatus(undefined);
    setAnswers({ writing_language: "fr" });
    setStep(1);
    setPhase("notice");
    setFlags({
      ageOver15: false,
      noticeAccepted: false,
      retainProfile: false,
      serviceImprovement: false,
    });
  }

  let content = null;

  if (phase === "notice")
    content = (
      <TopicNotice
        key="notice"
        {...flags}
        onChange={(patch) => setFlags((f) => ({ ...f, ...patch }))}
        onContinue={() => setPhase("quiz")}
        goPrivacy={goPrivacy}
      />
    );
  else if (phase === "review")
    content = (
      <TopicReview
        key="review"
        answers={answers}
        onAnswers={setAnswers}
        onBack={() => {
          setError("");
          setPhase("quiz");
        }}
        onGenerate={() => void generate(false)}
        onClear={clearAll}
        busy={busy}
        error={error}
        simulate={simulate}
        onSimulate={setSimulate}
      />
    );
  else if (phase === "enrich")
    content = (
      <TopicEnrich
        key="enrich"
        answers={answers}
        onAnswers={setAnswers}
        onContinue={() => void generate(true)}
        onSkip={() => void generate(true)}
        busy={busy}
        error={error}
      />
    );
  else if (phase === "results")
    content = (
      <TopicResults
        key="results"
        topics={topics}
        ticket={ticket}
        regenerationsRemaining={regens}
        model={model}
        simulated={simulated}
        personalizationLevel={personalizationLevel}
        reviewStatus={reviewStatus}
        axisStatus={axisStatus}
        answers={answers}
        consents={buildConsents()}
        busy={busy}
        error={error}
        onTopicsUpdate={setTopics}
        onRegenerate={regenerate}
        onRestart={restart}
        onEditProfile={() => {
          setError("");
          setPhase("review");
        }}
        onBusy={setBusy}
        onError={setError}
        onChooseTopic={
          onChooseTopic
            ? async (topic, docs) => {
                clearDraft();
                await onChooseTopic(topic, docs, sessionId, answers);
              }
            : undefined
        }
      />
    );
  else
    content = (
      <TopicQuestionnaire
        key={"quiz-" + step}
        step={step}
        answers={answers}
        onAnswers={setAnswers}
        onStep={setStep}
        onClear={clearAll}
        onReview={() => {
          setError("");
          setPhase("review");
        }}
        busy={busy}
        error={error}
      />
    );

  return (
    <>
      {confirmDialog}
      {content}
    </>
  );
}
