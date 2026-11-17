import { useEffect, useMemo, useState } from "react";
import { NOTICE_VERSION } from "../../../../shared/research/notice";
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
import TopicResults from "./TopicResults";
import { useConfirmDialog } from "./ConfirmDialog";
import {
  clearDraft,
  loadDraft,
  makeConsent,
  saveDraft,
} from "./storage";

type Phase = "notice" | "quiz" | "review" | "results";

type Props = {
  goPrivacy: () => void;
  onChooseTopic?: (topic: GeneratedTopic) => void;
};

export default function TopicGenerator({ goPrivacy, onChooseTopic }: Props) {
  const saved = useMemo(() => loadDraft(), []);
  const [phase, setPhase] = useState<Phase>(
    saved?.consents?.noticeAccepted?.value ? "quiz" : "notice",
  );
  const [step, setStep] = useState(saved?.step || 1);
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    saved?.answers || {},
  );
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
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

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

  async function generate() {
    setError("");
    if (!(await confirmSensitive())) return;
    setBusy(true);
    try {
      const res = await fetch("/api/topics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, consents: buildConsents() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Génération impossible.");
      setTopics(data.topics);
      setTicket(data.ticket);
      setRegens(data.regenerationsRemaining ?? 0);
      setModel(data.model || "");
      clearDraft();
      setPhase("results");
    } catch (e: any) {
      setError(e.message || "Génération impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(axis: TopicAxis, reason: RegenReason) {
    setError("");
    setBusy(true);
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Régénération impossible.");
      setTopics(data.topics);
      setTicket(data.ticket);
      setRegens(data.regenerationsRemaining ?? 0);
      setModel(data.model || "");
    } catch (e: any) {
      setError(e.message || "Régénération impossible.");
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
    setAnswers({});
    setStep(1);
    setTopics([]);
    setTicket("");
    setRegens(0);
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
    setAnswers({});
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
        onGenerate={generate}
        onClear={clearAll}
        busy={busy}
        error={error}
      />
    );
  else if (phase === "results")
    content = (
      <TopicResults
        key="results"
        topics={topics}
        regenerationsRemaining={regens}
        model={model}
        busy={busy}
        error={error}
        onRegenerate={regenerate}
        onRestart={restart}
        onChooseTopic={
          onChooseTopic
            ? (topic) => {
                clearDraft();
                onChooseTopic(topic);
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
