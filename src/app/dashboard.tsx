import { PublishHistory } from "./publish-history";
import type { HistoryBatch } from "@/lib/publish-status";

export interface Stats {
  total_posts: number;
  total_groups: number;
  total_published: number;
  total_errors: number;
  recent_activity: { level: string; message: string; time: string }[];
}

const metrics = [
  { key: "total_posts", label: "Посты", tone: "violet", icon: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6m-6 4h6"/></> },
  { key: "total_groups", label: "Группы", tone: "blue", icon: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M17 5a3 3 0 0 1 0 6m4 9v-2a4 4 0 0 0-3-4"/></> },
  { key: "total_published", label: "Отправлено", tone: "green", icon: <><path d="m3 10 18-7-7 18-3-8-8-3Zm8 3L21 3"/></> },
  { key: "total_errors", label: "Ошибки", tone: "orange", icon: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></> },
] as const;

export function Dashboard({ stats, batches, loading, error, busy, onPublish, onHistory }: {
  stats: Stats | null;
  batches: HistoryBatch[];
  loading: boolean;
  error: string;
  busy: boolean;
  onPublish: () => void;
  onHistory: () => void;
}) {
  return (
    <div className="dashboard">
      <h1 className="page-title">Главная</h1>
      <section className="dashboard-hero" aria-labelledby="dashboard-hero-title">
        <div className="dashboard-hero-art" aria-hidden="true" />
        <div className="dashboard-hero-content">
          <h2 id="dashboard-hero-title">Публикации в<br />сообщества VK</h2>
          <button className="btn dashboard-hero-button" onClick={onPublish}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            Новая публикация
          </button>
        </div>
      </section>
      <dl className="stats-grid">
        {metrics.map(({ key, label, tone, icon }) => (
          <div key={key} className="stat-card">
            <span className={`stat-icon ${tone}`}><svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg></span>
            <dt className="stat-label">{label}</dt>
            <dd className="stat-value">{stats?.[key]?.toLocaleString("ru-RU") ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <div className="dashboard-columns">
        <section className="dashboard-panel" aria-labelledby="dashboard-history">
          <header className="dashboard-panel-heading">
            <h2 id="dashboard-history">Последние публикации</h2>
            {batches.length > 0 && <button className="btn btn-secondary btn-sm" onClick={onHistory}>Вся история <span aria-hidden="true">↗</span></button>}
          </header>
          <PublishHistory batches={batches.slice(0, 4)} busy={busy} loading={loading} error={error} />
        </section>
        <section className="dashboard-panel" aria-labelledby="dashboard-activity">
          <header className="dashboard-panel-heading"><h2 id="dashboard-activity">Активность</h2></header>
          {stats?.recent_activity.length ? (
            <ul className="dashboard-activity">
              {stats.recent_activity.slice(0, 5).map((entry, index) => (
                <li key={`${entry.time}-${index}`}>
                  <span className={`activity-dot activity-${entry.level}`} aria-hidden="true" />
                  <div>
                    <p>{entry.message}</p>
                    <time dateTime={entry.time}>{new Date(entry.time).toLocaleString("ru-RU", {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })}</time>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="empty-state">Активности пока нет</p>}
        </section>
      </div>
    </div>
  );
}
