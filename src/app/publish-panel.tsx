import { useState, type Dispatch, type SetStateAction } from "react";
import { PublishPreview } from "./publish-preview";

type Group = { id: number; url: string; name: string; category: string };
type Post = { name: string; text: string; images: string[]; videos: string[] };
type Filter = "all" | "new" | "sent";

export interface PublishProgress {
  progress: number;
  status: string;
  done: boolean;
  success: number;
  suggested: number;
  failed: number;
  unknown: number;
  errors: { group: string; error: string; url?: string }[];
}

export function isNotSubscribed(error: string) {
  return /не подписан|not subscribed|not a member|isMember/i.test(error);
}

export function PublishPanel({
  posts, groups, selected, setSelected, postName, onSelectPost, posted,
  busy, progress, onStart, onCancel, onHistory, onAddGroup,
}: {
  posts: Post[];
  groups: Group[];
  selected: Set<number>;
  setSelected: Dispatch<SetStateAction<Set<number>>>;
  postName: string;
  onSelectPost: (name: string) => void;
  posted: Set<string> | null;
  busy: boolean;
  progress: PublishProgress;
  onStart: () => void;
  onCancel: () => void;
  onHistory: () => void;
  onAddGroup: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const categories = new Map<string, Group[]>();
  const search = query.trim().toLocaleLowerCase("ru-RU");
  const filtered = groups.filter(group =>
    (!posted || filter === "all" || posted.has(group.url) === (filter === "sent"))
    && [group.name, group.category, group.url].some(value => value.toLocaleLowerCase("ru-RU").includes(search)),
  );
  for (const group of filtered) {
    const category = categories.get(group.category) ?? [];
    category.push(group);
    categories.set(group.category, category);
  }
  const selectedPost = posts.find(post => post.name === postName);
  const selectedCount = groups.filter(group => selected.has(group.id)).length;

  function select(items: Group[], checked: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      for (const { id } of items) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  return (
    <div>
      <h1 className="page-title">Публикация</h1>
      <div className="publish-workspace">
        <section className="publish-section publish-source">
          <label htmlFor="publish-post" className="publish-section-title form-label">Пост</label>
          <select id="publish-post" className="select" disabled={busy} value={postName}
            onChange={event => { setFilter("all"); onSelectPost(event.target.value); }}>
            <option value="">Выберите пост</option>
            {posts.map(post => <option key={post.name} value={post.name}>{post.name}</option>)}
          </select>
        </section>
        <section className="publish-section publish-targets" aria-labelledby="publish-groups">
          <div className="publish-targets-heading">
            <h2 id="publish-groups" className="publish-section-title">Группы</h2>
            <span>{selectedCount} из {groups.length} выбрано</span>
          </div>
          {groups.length === 0 ? (
            <div className="empty-state"><p>Список групп пуст</p><button className="btn btn-secondary" onClick={onAddGroup}>Добавить группу</button></div>
          ) : (
            <>
              <div className="publish-search">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/></svg>
                <input className="input" type="search" aria-label="Поиск групп" placeholder="Поиск по названию или категории"
                  value={query} onChange={event => setQuery(event.target.value)} />
              </div>
              <div className="toolbar publish-controls">
                <label className="checkbox-item">
                  <input type="checkbox" disabled={busy || filtered.length === 0}
                    checked={filtered.length > 0 && filtered.every(group => selected.has(group.id))}
                    onChange={event => select(filtered, event.target.checked)} />
                  {search ? "Выбрать найденные" : "Выбрать все"}
                </label>
                {selectedPost && (
                  <select className="select publish-filter" aria-label="Отправка поста в группы" value={posted ? filter : "all"} disabled={busy || !posted}
                    onChange={event => { setFilter(event.target.value as Filter); setSelected(new Set()); }}>
                    <option value="all">Все группы</option>
                    <option value="new">Ещё не отправляли</option>
                    <option value="sent">Уже отправляли</option>
                  </select>
                )}
              </div>
              {filtered.length === 0 && <p className="empty-state">По этому фильтру групп нет</p>}
              {[...categories].map(([category, items]) => {
                const picked = items.filter(group => selected.has(group.id)).length;
                const categorySelection = search ? "Выбрать найденные в категории" : "Выбрать все в категории";
                return (
                  <div key={category} className="publish-category">
                    <label className="publish-category-check" title={categorySelection}>
                      <input aria-label={`${categorySelection} «${category}»`} type="checkbox" checked={picked === items.length}
                        disabled={busy} onChange={event => select(items, event.target.checked)} />
                    </label>
                    <details open={categories.size === 1}>
                      <summary>{category} <span>{picked} / {items.length}</span></summary>
                      <div className="checkbox-grid">
                        {items.map(group => (
                          <div className="checkbox-item publish-group" key={group.id}>
                            <label>
                              <input type="checkbox" checked={selected.has(group.id)} disabled={busy}
                                onChange={event => select([group], event.target.checked)} />
                              {group.name}
                            </label>
                            <a href={group.url} target="_blank" rel="noreferrer" aria-label={`Открыть ${group.name} в VK`}>↗</a>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                );
              })}
            </>
          )}
        </section>
        <aside className="publish-side" aria-label="Предпросмотр и отправка">
          <section className="publish-section publish-preview-panel">
            <h2 className="publish-section-title">Предпросмотр</h2>
            {selectedPost ? <><strong className="publish-preview-title">{selectedPost.name}</strong><PublishPreview post={selectedPost} /></> :
              <p className="publish-preview-empty">Выберите пост, чтобы увидеть его текст и вложения.</p>}
          </section>
          <div className="publish-actions">
            <button className="btn btn-primary" disabled={busy || !selectedPost || !selectedCount} onClick={onStart}>
              {busy ? "Публикация…" : selectedCount ? `Опубликовать в ${selectedCount} ${selectedCount === 1 ? "группе" : "группах"}` : "Опубликовать"}
            </button>
            {busy && <button className="btn btn-secondary" onClick={onCancel}>Отменить</button>}
          </div>
        </aside>
      </div>
      <div className={`progress-section${progress.status ? " active" : ""}`}>
        <div className="publish-progress-label">
          <span className="progress-text" aria-hidden="true">{progress.status}</span>
          {progress.status && <span className="progress-percent" aria-hidden="true">{progress.progress}%</span>}
        </div>
        {progress.status && (
          <div className="progress-bar-track" role="progressbar" aria-label="Обработка групп" aria-valuenow={progress.progress}>
            <div className="progress-bar-fill" style={{ width: `${progress.progress}%` }} />
          </div>
        )}
        {busy && <p className="publish-progress-note">Оставьте вкладку открытой до завершения рассылки.</p>}
      </div>
      <div className="publish-live-status" role="status" aria-atomic="true">{progress.status}</div>
      {progress.done && (
        <section className="results-section active" aria-labelledby="publish-results">
          <h2 id="publish-results" className="publish-section-title">Результаты</h2>
          <div className="results-summary">
            <div className="result-badge success">Опубликовано: {progress.success}</div>
            <div className="result-badge">В предложке: {progress.suggested}</div>
            <div className="result-badge failed">Ошибки: {progress.failed}</div>
            {progress.unknown > 0 && <div className="result-badge">Без подтверждения: {progress.unknown}</div>}
          </div>
          <button className="btn btn-secondary" onClick={onHistory}>Открыть историю</button>
          {progress.errors.length > 0 && (
            <ul className="error-list publish-errors" aria-label="Ошибки отправки по группам">
              {progress.errors.map((item, index) => (
                <li className="error-card" key={`${item.url}-${index}`}>
                  <div className="error-card-group">{item.group}</div>
                  <div className="error-card-msg">{item.error}</div>
                  {item.url && <a href={item.url} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer"
                    aria-label={`${isNotSubscribed(item.error) ? "Подписаться" : "Открыть в VK"}: ${item.group}`}>
                    {isNotSubscribed(item.error) ? "Подписаться" : "Открыть в VK"}
                  </a>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
