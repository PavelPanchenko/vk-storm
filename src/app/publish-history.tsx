import { publishStatusLabels, type HistoryBatch } from "@/lib/publish-status";

export function PublishHistory({ batches, onRefresh, onRetry, busy, loading, error }: {
  batches: HistoryBatch[];
  onRefresh?: () => void;
  onRetry?: (batch: HistoryBatch) => void;
  busy: boolean;
  loading?: boolean;
  error?: string;
}) {
  return (
    <div className="publication-history">
      {onRefresh && (
        <div className="toolbar dashboard-heading">
          <h1 className="page-title">История публикаций</h1>
          <div className="toolbar-spacer" />
          <button className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading}>Обновить</button>
        </div>
      )}
      {loading && <p role="status">Загрузка истории…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {!loading && !error && batches.length === 0 && <div className="empty-state">Публикаций пока нет</div>}
      {batches.map(batch => {
        const unsettled = batch.groups.filter(group => ["queued", "sending", "unknown"].includes(group.status)).length;
        return (
          <details key={batch.batchId} className="history-card">
            <summary>
              <span className="history-post">
                <strong>{batch.postName}</strong>
                <time dateTime={batch.createdAt}>{new Date(batch.createdAt).toLocaleString("ru-RU")}</time>
              </span>
              <span className="history-counts">
                {batch.successCount} из {batch.totalGroups} отправлено
                {batch.failedCount > 0 && <span className="history-error">Ошибки: {batch.failedCount}</span>}
                {unsettled > 0 && <span>Без итога: {unsettled}</span>}
              </span>
            </summary>
            <div className="history-details">
              {batch.postText && <p className="history-text">{batch.postText}</p>}
              <ul className="history-groups">
                {batch.groups.map((group, index) => (
                  <li key={`${group.groupUrl}-${index}`}>
                    <a href={group.postUrl ?? group.groupUrl} target="_blank" rel="noreferrer">{group.groupName || group.groupUrl} ↗</a>
                    <strong className={group.status === "failed" ? "history-error" : undefined}>{publishStatusLabels[group.status]}</strong>
                    {group.error && <p>{group.error}</p>}
                  </li>
                ))}
              </ul>
              {batch.canRetry && onRetry && (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onRetry(batch)}>Повторить для неотправленных</button>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
