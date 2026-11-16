export type PublishStatus = "queued" | "sending" | "published" | "suggested" | "failed" | "skipped" | "unknown" | "duplicate" | "sent";

export type PublishEvent =
  | { type: "started"; total: number }
  | { type: "phase"; message: string }
  | { type: "result"; group: { url: string; name: string }; status: PublishStatus; error?: string; completed: number; total: number }
  | { type: "done" }
  | { type: "interrupted"; message?: string };

export function isRetryable(status: PublishStatus) {
  return status === "failed" || status === "skipped";
}

export const publishStatusLabels: Record<PublishStatus, string> = {
  queued: "В очереди",
  sending: "Ожидает подтверждения VK",
  published: "Опубликовано",
  suggested: "Отправлено в предложку",
  failed: "Ошибка",
  skipped: "Не отправлено",
  unknown: "Проверьте результат в VK",
  duplicate: "Повторная ссылка",
  sent: "Отправлено",
};

export interface HistoryBatch {
  batchId: string;
  postName: string;
  postText: string;
  createdAt: string;
  totalGroups: number;
  successCount: number;
  failedCount: number;
  canRetry: boolean;
  groups: {
    groupUrl: string;
    groupName: string;
    status: PublishStatus;
    postUrl: string | null;
    error: string | null;
  }[];
}
