import { NOTICE_VERSION } from "../../../../shared/research/notice";
import type { TopicConsents } from "../../../../shared/research/topicTypes";

const KEY = "manuscrit.topicGenerator.draft.v1";

export type TopicDraft = {
  answers: Record<string, unknown>;
  consents: Partial<TopicConsents> | null;
  step: number;
  noticeVersion: string;
  updatedAt: string;
};

export function loadDraft(): TopicDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as TopicDraft;
    if (data.noticeVersion !== NOTICE_VERSION) {
      clearDraft();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function saveDraft(draft: TopicDraft) {
  localStorage.setItem(
    KEY,
    JSON.stringify({ ...draft, noticeVersion: NOTICE_VERSION, updatedAt: new Date().toISOString() }),
  );
}

export function clearDraft() {
  localStorage.removeItem(KEY);
}

export function makeConsent(value: boolean) {
  return {
    value,
    at: new Date().toISOString(),
    noticeVersion: NOTICE_VERSION,
  };
}
