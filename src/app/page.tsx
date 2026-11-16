"use client";

import { useState, useEffect, useRef, useCallback, useId, useMemo } from "react";
import Image from "next/image";
import brandIcon from "./icon.png";
import { mediaUploadConfig } from "@/lib/media-upload-config";
import type { HistoryBatch, PublishEvent } from "@/lib/publish-status";
import { Dashboard, type Stats } from "./dashboard";
import { PublishHistory } from "./publish-history";
import { isNotSubscribed, PublishPanel, type PublishProgress } from "./publish-panel";

type Theme = "dark" | "light";

async function uploadFile(
  file: File,
  kind: "image" | "video",
  direct: boolean,
  onProgress: (pct: number) => void,
): Promise<{ url: string }> {
  if (direct) {
    const { extensions, maxBytes } = mediaUploadConfig[kind];
    if (!Object.hasOwn(extensions, file.type)) throw new Error("Неподдерживаемый формат вложения");
    if (file.size > maxBytes) throw new Error(`Файл слишком большой. Лимит: ${maxBytes / 1024 ** 2} МБ`);
    const { upload } = await import("@vercel/blob/client");
    const pathname = `blob/${crypto.randomUUID()}.${extensions[file.type]}`;
    await upload(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/blob/upload",
      clientPayload: kind,
      multipart: file.size > 5 * 1024 * 1024,
      onUploadProgress: ({ percentage }) => onProgress(Math.round(percentage)),
    });
    return { url: `/uploads/${pathname}` };
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as { url: string }); } catch { reject(new Error("Некорректный ответ сервера")); }
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const j = JSON.parse(xhr.responseText) as { error?: string; detail?: string };
          msg = j.error || j.detail || msg;
        } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Ошибка сети при загрузке"));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    xhr.open("POST", "/api/blob/upload");
    xhr.send(fd);
  });
}

/* ===== TYPES ===== */
interface User { user_id: string; name: string; avatar: string; direct_blob_upload?: boolean }
interface Post { name: string; text: string; image_count: number; images: string[]; videos: string[] }
interface Group { id: number; url: string; name: string; category: string; photo: string; members_count: number; status: string; last_published: string | null; total_published: number }
interface ToastItem { id: number; message: string; type: string }
const views = ["dashboard", "posts", "groups", "publish", "history", "parser", "logs"];
let toastId = 0;

/* ===== MAIN ===== */
export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTabState] = useState("dashboard");
  const setTab = useCallback((view: string) => {
    if (window.location.hash !== `#${view}`) window.history.pushState(null, "", `#${view}`);
    setTabState(view);
  }, []);
  useEffect(() => {
    const syncView = () => {
      const requested = window.location.hash.slice(1);
      setTabState(views.includes(requested) ? requested : "dashboard");
    };
    syncView();
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);
  const [theme, setTheme] = useState<Theme>("light");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [logLevel, setLogLevelState] = useState("all");

  // Modals
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showEditPost, setShowEditPost] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [showBulkGroup, setShowBulkGroup] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmData, setConfirmData] = useState({ title: "", message: "", onConfirm: () => {} });

  // Post form
  const [postName, setPostName] = useState("");
  const [postText, setPostText] = useState("");
  const [postFiles, setPostFiles] = useState<File[]>([]);
  const [postVideoFiles, setPostVideoFiles] = useState<File[]>([]);
  const [postNameError, setPostNameError] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; pct: number } | null>(null);

  // Edit post
  const [editName, setEditName] = useState("");
  const [editText, setEditText] = useState("");
  const [editExistingImages, setEditExistingImages] = useState<string[]>([]);
  const [editExistingVideos, setEditExistingVideos] = useState<string[]>([]);
  const [editNewFiles, setEditNewFiles] = useState<File[]>([]);
  const [editNewVideoFiles, setEditNewVideoFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  // Group form
  const [groupUrl, setGroupUrl] = useState("");
  const [groupUrlError, setGroupUrlError] = useState("");
  const [groupCategory, setGroupCategory] = useState("");
  const [bulkUrls, setBulkUrls] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [groupSelectedIds, setGroupSelectedIds] = useState<Set<number>>(new Set());
  const [groupMoveCategory, setGroupMoveCategory] = useState("");
  const [groupFriends, setGroupFriends] = useState<Record<string, number>>({});
  const [loadingFriends, setLoadingFriends] = useState(false);

  // Parser
  const [parserQuery, setParserQuery] = useState("");
  const [parserResults, setParserResults] = useState<{ id: number; name: string; screen_name: string; photo: string; members_count: number; activity: string; description: string; is_closed: number; can_post: boolean; can_suggest: boolean; url: string; friends_count?: number }[]>([]);
  const [parserTotal, setParserTotal] = useState(0);
  const [parserSearching, setParserSearching] = useState(false);
  const [parserCategory, setParserCategory] = useState("");
  const [parserAddingIds, setParserAddingIds] = useState<Set<number>>(new Set());
  const [parserAddedIds, setParserAddedIds] = useState<Set<number>>(new Set());
  const [parserSelectedIds, setParserSelectedIds] = useState<Set<number>>(new Set());
  const [parserCity, setParserCity] = useState("");
  const [parserCityId, setParserCityId] = useState<number | undefined>();
  const [parserCitySuggestions, setParserCitySuggestions] = useState<{ id: number; title: string; region?: string }[]>([]);
  const [parserCityOpen, setParserCityOpen] = useState(false);
  const [parserMembersMin, setParserMembersMin] = useState("");
  const [parserMembersMax, setParserMembersMax] = useState("");
  const [blacklistedUrls, setBlacklistedUrls] = useState<Set<string>>(new Set());

  // Publish
  const [publishPost, setPublishPost] = useState("");
  const [publishGroups, setPublishGroups] = useState<Set<number>>(new Set());
  const [postedGroups, setPostedGroups] = useState<{ postName: string; urls: Set<string> } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState<PublishProgress>({ progress: 0, status: "", done: false, success: 0, suggested: 0, failed: 0, unknown: 0, errors: [] });
  const [showSubscribeAllPrompt, setShowSubscribeAllPrompt] = useState(false);
  const [subscribePromptSeenKey, setSubscribePromptSeenKey] = useState("");
  const [joiningCommunities, setJoiningCommunities] = useState(false);

  // History
  const [history, setHistory] = useState<HistoryBatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");


  /* ===== TOAST ===== */
  const toast = useCallback((message: string, type = "info") => {
    const id = ++toastId;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === "error" ? 8000 : 4000);
  }, []);

  /* ===== API ===== */
  const apiFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
    });
    if (res.status === 401) {
      let reason = "";
      try { const d = await res.json(); reason = d.reason || ""; } catch {}
      setUser(null);
      // Force a clean re-auth when the session has expired or refresh failed
      if (reason === "expired" || reason === "refresh_failed" || reason === "refresh_error") {
        try { window.location.href = "/"; } catch {}
      }
      throw new Error("Не авторизован");
    }
    if (!res.ok) {
      let errMsg = `Ошибка ${res.status}`;
      try { const d = await res.json(); errMsg = d.detail || d.error || JSON.stringify(d); } catch {}
      throw new Error(errMsg);
    }
    const ct = res.headers.get("content-type");
    if (ct?.includes("application/json")) return res.json();
    return res.text();
  }, []);

  /* ===== AUTH ===== */
  useEffect(() => {
    apiFetch("/api/auth/me").then(d => { setUser(d); setAuthChecked(true); }).catch(() => setAuthChecked(true));
  }, [apiFetch]);

  /* ===== THEME ===== */
  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("theme")) as Theme | null;
    const initial: Theme = stored === "light" || stored === "dark" ? stored : "light";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch {}
      return next;
    });
  }, []);

  /* ===== DOCUMENT TITLE (показывать прогресс публикации во вкладке) ===== */
  useEffect(() => {
    const base = "VK Storm";
    if (!publishing) {
      document.title = base;
      return;
    }
    document.title = `(${publishProgress.progress}%) ${publishProgress.status} — ${base}`;
  }, [publishing, publishProgress.progress, publishProgress.status]);

  const vkOneTapRef = useRef<HTMLDivElement>(null);

  // PKCE helpers for browser (Web Crypto)
  const generatePKCE = useCallback(async () => {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    const verifier = btoa(String.fromCharCode(...buf))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return { verifier, challenge };
  }, []);

  // Init VK ID OneTap widget
  useEffect(() => {
    if (user || !authChecked) return;

    let codeVerifierStored = "";

    type VKIDOneTapInstance = {
      render: (opts: { container: HTMLElement; showAlternativeLogin?: boolean }) => VKIDOneTapInstance;
      on: (event: string, cb: (payload: VKIDLoginPayload | VKIDErrorPayload) => void) => VKIDOneTapInstance;
    };
    type VKIDLoginPayload = { code: string; device_id: string };
    type VKIDErrorPayload = { code?: string; message?: string };
    type VKIDSDK = {
      Config: { init: (opts: Record<string, unknown>) => void };
      ConfigResponseMode: { Callback: string };
      ConfigSource: { LOWCODE: string };
      WidgetEvents: { ERROR: string };
      OneTapInternalEvents: { LOGIN_SUCCESS: string };
      OneTap: new () => VKIDOneTapInstance;
    };

    const script = document.createElement("script");
    script.src = "https://unpkg.com/@vkid/sdk@<3.0.0/dist-sdk/umd/index.js";
    script.onload = async () => {
      const VKID = (window as unknown as { VKIDSDK?: VKIDSDK }).VKIDSDK;
      if (!VKID) return;

      const pkce = await generatePKCE();
      codeVerifierStored = pkce.verifier;

      VKID.Config.init({
        app: Number(process.env.NEXT_PUBLIC_VK_APP_ID),
        redirectUrl: process.env.NEXT_PUBLIC_VK_REDIRECT_URI,
        responseMode: VKID.ConfigResponseMode.Callback,
        source: VKID.ConfigSource.LOWCODE,
        scope: "wall photos groups",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
      });

      const oneTap = new VKID.OneTap();
      if (!vkOneTapRef.current) return;

      oneTap.render({
        container: vkOneTapRef.current,
        showAlternativeLogin: true,
      })
      .on(VKID.WidgetEvents.ERROR, (err) => {
        console.error("VK ID error", err);
        toast("Ошибка авторизации VK ID", "error");
      })
      .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, (payload) => {
        const { code, device_id: deviceId } = payload as VKIDLoginPayload;

        // Send code + our PKCE verifier to server for exchange
        fetch("/api/auth/vkid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, device_id: deviceId, code_verifier: codeVerifierStored }),
        })
          .then(r => r.json())
          .then(res => {
            if (res.ok) window.location.reload();
            else toast("Ошибка создания сессии", "error");
          })
          .catch(() => toast("Ошибка сети", "error"));
      });
    };
    document.body.appendChild(script);

    return () => { script.remove(); };
  }, [user, authChecked, toast, generatePKCE]);

  const logout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      window.location.assign("/");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  /* ===== DATA LOADING ===== */
  const loadStats = useCallback(async () => { try { setStats(await apiFetch("/api/stats")); } catch {} }, [apiFetch]);
  const loadPosts = useCallback(async () => { try { const d = await apiFetch("/api/posts"); setPosts(Array.isArray(d) ? d : d.posts || []); } catch {} }, [apiFetch]);
  const loadGroups = useCallback(async () => { try { const d = await apiFetch("/api/groups"); setGroups(Array.isArray(d) ? d : d.groups || []); } catch {} }, [apiFetch]);
  const loadLogs = useCallback(async () => { try { const d = await apiFetch(`/api/logs?level=${logLevel}`); setLogs(d.lines || []); } catch {} }, [apiFetch, logLevel]);
  const loadBlacklist = useCallback(async () => { try { const d = await apiFetch("/api/blacklist"); setBlacklistedUrls(new Set((d as { url: string }[]).map((b) => b.url))); } catch {} }, [apiFetch]);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const batches = await apiFetch("/api/publish/history");
      setHistory(Array.isArray(batches) ? batches : []);
    } catch (error) {
      setHistoryError(`Не удалось загрузить историю: ${(error as Error).message}`);
    } finally {
      setHistoryLoading(false);
    }
  }, [apiFetch]);


  useEffect(() => {
    if (!user) return;
    if (tab === "dashboard") { loadStats(); loadHistory(); }
    else if (tab === "posts") loadPosts();
    else if (tab === "groups") loadGroups();
    else if (tab === "logs") loadLogs();
    else if (tab === "parser") { loadGroups(); loadBlacklist(); }
    else if (tab === "publish") { loadPosts(); loadGroups(); }
    else if (tab === "history") loadHistory();
  }, [user, tab, loadStats, loadPosts, loadGroups, loadLogs, loadBlacklist, loadHistory]);

  useEffect(() => {
    if (!publishPost || publishing || tab !== "publish") return;
    const controller = new AbortController();
    apiFetch(`/api/publish/posted-groups?postName=${encodeURIComponent(publishPost)}`, { signal: controller.signal })
      .then((urls: string[]) => setPostedGroups({ postName: publishPost, urls: new Set(urls) }))
      .catch(() => { if (!controller.signal.aborted) setPostedGroups(null); });
    return () => controller.abort();
  }, [publishPost, publishing, tab, apiFetch]);

  /* ===== POST CRUD ===== */
  const uploadFilesToBlob = useCallback(async (files: File[], _postSlug: string, kind: "image" | "video"): Promise<string[]> => {
    const urls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setUploadProgress({ name: f.name, pct: 0 });
      try {
        const { url } = await uploadFile(f, kind, Boolean(user?.direct_blob_upload), (pct) => setUploadProgress({ name: f.name, pct }));
        urls.push(url);
      } catch (e) {
        setUploadProgress(null);
        const msg = (e as Error).message || String(e);
        if (/size|too large|exceed|слишком большой/i.test(msg)) throw new Error(`Файл "${f.name}" слишком большой. Лимит: ${kind === "video" ? "500 MB" : "20 MB"}`);
        if (/content.?type|allowed|неподдерживаем/i.test(msg)) throw new Error(`Неподдерживаемый тип файла: ${f.name}`);
        throw new Error(`Ошибка загрузки "${f.name}": ${msg}`);
      }
    }
    setUploadProgress(null);
    return urls;
  }, [user?.direct_blob_upload]);

  const createPost = async () => {
    setPostNameError("");
    if (!postName.trim()) { setPostNameError("Введите название поста"); return; }
    setCreating(true);
    try {
      const name = postName.trim();
      const imageUrls = await uploadFilesToBlob(postFiles, name, "image");
      const videoUrls = await uploadFilesToBlob(postVideoFiles, name, "video");
      await apiFetch("/api/posts", {
        method: "POST",
        body: JSON.stringify({ name, text: postText, images: imageUrls, videos: videoUrls }),
      });
      toast("Пост создан", "success");
      setShowCreatePost(false);
      loadPosts();
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setCreating(false); setUploadProgress(null); }
  };

  const openEditPost = async (name: string) => {
    setEditName(name); setEditText(""); setEditExistingImages([]); setEditExistingVideos([]); setEditNewFiles([]); setEditNewVideoFiles([]); setShowEditPost(true);
    try {
      const p = await apiFetch(`/api/posts/${encodeURIComponent(name)}`);
      setEditText(p.text || "");
      setEditExistingImages(p.images || []);
      setEditExistingVideos(p.videos || []);
    } catch {}
  };

  const deleteExistingImage = (imgUrl: string) => {
    setEditExistingImages(prev => prev.filter(i => i !== imgUrl));
    toast("Изображение убрано", "success");
  };

  const deleteExistingVideo = (videoUrl: string) => {
    setEditExistingVideos(prev => prev.filter(v => v !== videoUrl));
    toast("Видео убрано", "success");
  };

  const saveEditPost = async () => {
    setSaving(true);
    try {
      const newImageUrls = await uploadFilesToBlob(editNewFiles, editName, "image");
      const newVideoUrls = await uploadFilesToBlob(editNewVideoFiles, editName, "video");
      await apiFetch(`/api/posts/${encodeURIComponent(editName)}`, {
        method: "PUT",
        body: JSON.stringify({
          text: editText,
          images: [...editExistingImages, ...newImageUrls],
          videos: [...editExistingVideos, ...newVideoUrls],
        }),
      });
      toast("Пост обновлен", "success"); setShowEditPost(false); loadPosts();
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setSaving(false); setUploadProgress(null); }
  };

  const deletePost = async (name: string) => {
    try { await apiFetch(`/api/posts/${encodeURIComponent(name)}`, { method: "DELETE" }); toast("Пост удален", "success"); loadPosts(); } catch {}
  };

  /* ===== GROUP CRUD ===== */
  const addGroup = async () => {
    setGroupUrlError("");
    if (!groupUrl.trim()) { setGroupUrlError("Введите URL"); return; }
    try {
      await apiFetch("/api/groups", { method: "POST", body: JSON.stringify({ url: groupUrl.trim(), category: groupCategory.trim() || undefined }) });
      toast("Группа добавлена", "success"); setShowAddGroup(false); loadGroups();
    } catch (e) { toast((e as Error).message, "error"); }
  };

  const deleteGroup = async (id: number) => {
    try { await apiFetch(`/api/groups/${id}`, { method: "DELETE" }); toast("Группа удалена", "success"); loadGroups(); } catch {}
  };

  const bulkImportGroups = async () => {
    setBulkError("");
    if (!bulkUrls.trim()) { setBulkError("Введите ссылки"); return; }
    setBulkImporting(true);
    try {
      const r = await apiFetch("/api/groups/bulk", { method: "POST", body: JSON.stringify({ urls: bulkUrls, category: bulkCategory.trim() || undefined }) });
      let msg = `Добавлено: ${r.added}`;
      if (r.skipped > 0) msg += `, пропущено: ${r.skipped}`;
      toast(msg, r.added > 0 ? "success" : "warning");
      setShowBulkGroup(false); loadGroups();
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBulkImporting(false); }
  };

  const checkAllGroups = async () => {
    if (publishingRef.current) { toast("Дождитесь окончания публикации", "warning"); return; }
    try { toast("Проверка групп...", "info"); await apiFetch("/api/groups/check", { method: "POST" }); toast("Проверка завершена", "success"); loadGroups(); } catch {}
  };

  const changeGroupCategory = async (id: number, category: string) => {
    try {
      await apiFetch(`/api/groups/${id}`, { method: "PATCH", body: JSON.stringify({ category }) });
      loadGroups();
    } catch (e) { toast((e as Error).message, "error"); }
  };

  const massMoveGroups = async (category: string) => {
    if (!category.trim() || groupSelectedIds.size === 0) return;
    const urls = groups.filter(g => groupSelectedIds.has(g.id)).map(g => g.url);
    try {
      const res = await apiFetch("/api/groups/bulk", { method: "PATCH", body: JSON.stringify({ urls, category: category.trim() }) });
      toast(`Перемещено: ${res.moved}`, "success");
    } catch (e) { toast((e as Error).message, "error"); }
    setGroupSelectedIds(new Set());
    setGroupMoveCategory("");
    loadGroups();
  };

  const massDeleteGroups = async () => {
    if (groupSelectedIds.size === 0) return;
    const urls = groups.filter(g => groupSelectedIds.has(g.id)).map(g => g.url);
    try {
      const res = await apiFetch("/api/groups/bulk", { method: "DELETE", body: JSON.stringify({ urls }) });
      toast(`Удалено: ${res.deleted}`, "success");
      setGroups(prev => prev.filter(g => !urls.includes(g.url)));
    } catch (e) { toast((e as Error).message, "error"); }
    setGroupSelectedIds(new Set());
    loadGroups();
  };

  const fetchFriendsBatch = useCallback(async (groupIds: string[], signal?: AbortSignal): Promise<Record<string, number>> => {
    if (!user || groupIds.length === 0) return {};
    try {
      const resp = await apiFetch("/api/groups/friends-batch", {
        method: "POST",
        body: JSON.stringify({ groupIds }),
        signal,
      }) as { counts?: Record<string, number> };
      return resp.counts || {};
    } catch { return {}; }
  }, [user, apiFetch]);

  const loadGroupsFriends = async () => {
    if (!user || groups.length === 0 || publishingRef.current) return;
    setLoadingFriends(true);
    try {
      const idMap = new Map<string, string>();
      for (const g of groups) {
        const screenName = g.url.replace(/\/$/, "").split("/").pop() || "";
        if (screenName) idMap.set(screenName, g.url);
      }
      const counts = await fetchFriendsBatch(Array.from(idMap.keys()));
      setGroupFriends(prev => {
        const next = { ...prev };
        for (const [sn, url] of idMap) next[url] = counts[sn] ?? 0;
        return next;
      });
    } finally {
      setLoadingFriends(false);
    }
  };

  // Map of existing group URLs to their data for parser cross-check
  const existingGroupUrls = new Map(groups.map(g => [g.url, g]));

  /* ===== PARSER ===== */

  const parserCitySearch = async (q: string) => {
    setParserCity(q);
    setParserCityId(undefined);
    if (q.trim().length < 2 || !user) { setParserCitySuggestions([]); setParserCityOpen(false); return; }
    try {
      const resp = await apiFetch(`/api/cities?q=${encodeURIComponent(q.trim())}`) as { items?: { id: number; title: string; region?: string }[] };
      const items = resp.items || [];
      setParserCitySuggestions(items);
      setParserCityOpen(items.length > 0);
    } catch { setParserCitySuggestions([]); }
  };

  const parserSelectCity = (city: { id: number; title: string; region?: string }) => {
    setParserCity(city.title + (city.region ? `, ${city.region}` : ""));
    setParserCityId(city.id);
    setParserCityOpen(false);
  };

  const parserFriendsAbortRef = useRef<AbortController | null>(null);

  const parserSearch = async (offset = 0) => {
    if (!parserQuery.trim() || !user) return;
    setParserSearching(true);
    parserFriendsAbortRef.current?.abort();
    try {
      const sp = new URLSearchParams({ q: parserQuery.trim(), count: "40", offset: String(offset) });
      if (parserCityId) sp.set("city_id", String(parserCityId));
      const resp = await apiFetch(`/api/groups/search?${sp}`) as {
        total: number;
        items: { id: number; name: string; screen_name: string; photo: string; members_count: number; activity: string; description: string; is_closed: number; can_post: boolean; can_suggest: boolean; url: string }[];
      };
      const items = resp.items || [];
      if (offset === 0) {
        setParserResults(items);
        setParserSelectedIds(new Set());
      } else {
        setParserResults(prev => [...prev, ...items]);
      }
      setParserTotal(resp.total || 0);

      const abort = new AbortController();
      parserFriendsAbortRef.current = abort;
      (async () => {
        const groupIds = items.map(g => g.screen_name || `club${g.id}`).filter(Boolean);
        const counts = await fetchFriendsBatch(groupIds, abort.signal);
        if (abort.signal.aborted) return;
        setParserResults(prev => prev.map(p => {
          const key = p.screen_name || `club${p.id}`;
          return key in counts ? { ...p, friends_count: counts[key] } : p;
        }));
      })();
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setParserSearching(false); }
  };

  useEffect(() => () => parserFriendsAbortRef.current?.abort(), []);

  const parserToggleSelect = (id: number) => {
    setParserSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const isGroupExisting = (url: string) => existingGroupUrls.has(url) || parserAddedIds.has(parserResults.find(g => g.url === url)?.id ?? -1);
  const isGroupBlacklisted = (url: string) => blacklistedUrls.has(url);
  const getExistingGroup = (url: string) => existingGroupUrls.get(url);

  const parserSelectAllOpen = () => {
    const openIds = parserResults.filter(g => g.is_closed === 0 && !isGroupExisting(g.url) && !isGroupBlacklisted(g.url)).map(g => g.id);
    setParserSelectedIds(prev => {
      const allSelected = openIds.every(id => prev.has(id));
      if (allSelected) return new Set();
      return new Set(openIds);
    });
  };

  const parserAddSelected = async () => {
    const toAdd = parserResults.filter(g => parserSelectedIds.has(g.id) && !isGroupExisting(g.url));
    if (toAdd.length === 0) { toast("Выберите группы", "warning"); return; }
    for (const group of toAdd) {
      setParserAddingIds(prev => new Set(prev).add(group.id));
      try {
        await apiFetch("/api/groups", { method: "POST", body: JSON.stringify({ url: group.url, category: parserCategory.trim() || undefined, photo: group.photo || "", members_count: group.members_count || 0 }) });
        setParserAddedIds(prev => new Set(prev).add(group.id));
      } catch (e) { toast(`${group.name}: ${(e as Error).message}`, "error"); }
      finally { setParserAddingIds(prev => { const n = new Set(prev); n.delete(group.id); return n; }); }
    }
    toast(`Добавлено: ${toAdd.length}`, "success");
    loadGroups();
  };

  const parserMoveCategory = async (groupUrl: string, newCategory: string) => {
    const group = groups.find(g => g.url === groupUrl);
    if (!group) return;
    try {
      await apiFetch(`/api/groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ category: newCategory }) });
      toast("Категория обновлена", "success");
      loadGroups();
    } catch (e) { toast((e as Error).message, "error"); }
  };

  /* ===== PUBLISH ===== */
  const getNotSubscribedCommunityUrls = useCallback(() => {
    return Array.from(new Set(
      publishProgress.errors
        .filter(e => e.url && isNotSubscribed(e.error))
        .map(e => e.url as string),
    ));
  }, [publishProgress.errors]);

  const publishCancelRef = useRef(false);
  const publishingRef = useRef(false);

  const publishAbortRef = useRef<AbortController | null>(null);

  const startPublish = async (retry?: HistoryBatch) => {
    if (publishingRef.current) return;
    const postName = retry?.postName ?? publishPost;
    const groupIds = groups.filter(g => publishGroups.has(g.id)).map(g => g.id);
    if (!postName || (!retry && groupIds.length === 0)) return;

    publishingRef.current = true;
    publishCancelRef.current = false;
    setPublishing(true);
    setPostedGroups(null);
    setTab("publish");
    if (retry) {
      setPublishPost(postName);
      setPublishGroups(new Set());
    }

    const abort = new AbortController();
    publishAbortRef.current = abort;
    const progress: PublishProgress = { progress: 0, status: "Проверка групп…", done: false, success: 0, suggested: 0, failed: 0, unknown: 0, errors: [] };
    setPublishProgress({ ...progress });
    try {
      const response = await fetch("/api/publish/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: crypto.randomUUID(), postName, groupIds, retryOf: retry?.batchId }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? `Ошибка HTTP ${response.status}`);
      }

      setPublishGroups(new Set());
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (!frame.startsWith("data: ")) continue;
            const event = JSON.parse(frame.slice(6)) as PublishEvent;
            if (event.type === "phase") progress.status = event.message;
            if (event.type === "result") {
              if (event.status === "published") progress.success++;
              if (event.status === "suggested") progress.suggested++;
              if (event.status === "failed") progress.failed++;
              if (event.status === "unknown") progress.unknown++;
              if (event.error) progress.errors.push({ group: event.group.name, error: event.error, url: event.group.url });
              progress.progress = Math.round(event.completed / event.total * 100);
              progress.status = `Обработано ${event.completed} из ${event.total}`;
            }
            if (event.type === "done") finished = true;
            setPublishProgress({ ...progress });
          }
        }
      } finally {
        reader.releaseLock();
      }
      progress.status = finished ? "Отправка завершена" : "Отправка прервалась. Результаты доступны в истории";
    } catch (error) {
      progress.status = publishCancelRef.current
        ? "Отмена запрошена. Проверьте итог в истории"
        : `Отправка прервалась: ${(error as Error).message}. Проверьте историю`;
    } finally {
      progress.done = true;
      setPublishProgress({ ...progress });
      publishAbortRef.current = null;
      publishingRef.current = false;
      setPublishing(false);
      loadHistory();
    }
  };

  const cancelPublish = () => {
    publishCancelRef.current = true;
    publishAbortRef.current?.abort();
  };


  const openConfirmDialog = (title: string, message: string, onConfirm: () => void) => {
    setConfirmData({ title, message, onConfirm }); setShowConfirm(true);
  };

  useEffect(() => {
    if (!publishProgress.done || publishing) return;
    const urls = getNotSubscribedCommunityUrls();
    if (urls.length === 0) return;
    const key = urls.slice().sort().join("|");
    if (!key || key === subscribePromptSeenKey) return;
    setSubscribePromptSeenKey(key);
    setShowSubscribeAllPrompt(true);
  }, [publishProgress.done, publishing, getNotSubscribedCommunityUrls, subscribePromptSeenKey]);

  /* ===== RENDER ===== */
  if (!authChecked) return <div id="login-screen" role="status">Загрузка VK Storm…</div>;

  if (!user) {
    return (
      <div id="login-screen">
        <div className="login-card">
          <div className="login-logo"><BrandMark /> VK Storm</div>
          <h1>Публикации в VK</h1>
          <p className="login-subtitle">Войдите через VK ID, чтобы управлять постами и группами.</p>
          <div ref={vkOneTapRef} style={{width:"100%"}} />
        </div>
      </div>
    );
  }

  return (
    <>
      <button className="hamburger" aria-label="Меню" aria-expanded={sidebarOpen} aria-controls="main-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
        <svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      {sidebarOpen && <div className="sidebar-overlay open" onClick={() => setSidebarOpen(false)} />}

      <div className="app-layout">
        <aside id="main-sidebar" className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sidebar-header"><a className="sidebar-brand" href="#dashboard"><BrandMark /> VK Storm</a></div>
          <nav className="sidebar-nav" aria-label="Разделы VK Storm">
            {([
              ["dashboard", "Главная", <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>],
              ["posts", "Посты", <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>],
              ["groups", "Группы", <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>],
              ["publish", "Публикация", <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>],
              ["history", "История", <><polyline points="12 8 12 12 14 14"/><circle cx="12" cy="12" r="10"/></>],
              ["parser", "Парсер", <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>],
              ["logs", "Логи", <><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>],
            ] as [string, string, React.ReactNode][]).map(([id, label, icon]) => (
              <a href={`#${id}`} key={id} aria-current={tab === id ? "page" : undefined} className={`nav-item${tab === id ? " active" : ""}`} onClick={event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                setTab(id);
                setSidebarOpen(false);
              }}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>{label}
              </a>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="user-info">
              {user.avatar ? <Image className="user-avatar" src={user.avatar} alt="" width={36} height={36} unoptimized /> :
                <span className="user-avatar user-initial" aria-hidden="true">{(user.name || "VK").trim().slice(0, 1).toUpperCase()}</span>}
              <div className="user-name">{user.name || "Пользователь"}</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn btn-secondary btn-sm" onClick={toggleTheme} title="Сменить тему" aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}>
                {theme === "dark"
                  ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
                  : <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
              </button>
              <button className="logout-btn" onClick={logout} style={{flex:1}}>Выйти</button>
            </div>
          </div>
        </aside>

        <main className="main-content">
          <div className="content-frame">
          {tab === "dashboard" && (
            <Dashboard stats={stats} batches={history} loading={historyLoading} error={historyError} busy={publishing}
              onPublish={() => setTab("publish")} onHistory={() => setTab("history")} />
          )}

          {/* Posts */}
          {tab === "posts" && (
            <div>
              <div className="toolbar">
                <h1 className="page-title" style={{marginBottom:0}}>Посты</h1>
                <div className="toolbar-spacer"/>
                <button className="btn btn-primary" onClick={() => {setPostName("");setPostText("");setPostFiles([]);setPostNameError("");setShowCreatePost(true);}}>
                  <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Создать пост
                </button>
              </div>
              <div className="posts-grid">
                {posts.length===0 ? <div className="empty-state" style={{gridColumn:"1/-1"}}><p>Нет постов</p></div> :
                  posts.map(p => (
                    <article key={p.name} className="post-card">
                      {p.images[0] && <Image className="post-cover" src={p.images[0]} alt="" width={380} height={170} unoptimized />}
                      <div className="post-card-header">
                        <div className="post-card-title">{p.name}</div>
                        <div style={{display:"flex",gap:4}}>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditPost(p.name)} title="Редактировать" aria-label={`Редактировать «${p.name}»`}>
                            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button className="btn btn-danger btn-sm" aria-label={`Удалить «${p.name}»`} onClick={() => openConfirmDialog("Удалить пост?",p.name,() => deletePost(p.name))}>
                            <svg viewBox="0 0 24 24" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </div>
                      <div className="post-card-text">{p.text ? (p.text.length>100?p.text.slice(0,100)+"...":p.text) : <em style={{color:"var(--text-muted)"}}>Нет текста</em>}</div>
                      <div className="post-card-footer" style={{display:"flex",gap:6}}>{p.image_count > 0 && <span className="badge badge-info">{p.image_count} изобр.</span>}{p.videos?.length > 0 && <span className="badge badge-secondary">{p.videos.length} видео</span>}</div>
                    </article>
                  ))}
              </div>
            </div>
          )}

          {/* Groups */}
          {tab === "groups" && (
            <div>
              <div className="toolbar">
                <h1 className="page-title" style={{marginBottom:0}}>Группы</h1>
                <div className="toolbar-spacer"/>
                <button className="btn btn-success btn-sm" onClick={checkAllGroups}><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Проверить все</button>
                <button className="btn btn-secondary" onClick={() => {setBulkUrls("");setBulkCategory("");setBulkError("");setShowBulkGroup(true);}}>
                  <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Импорт
                </button>
                <button className="btn btn-primary" onClick={() => {setGroupUrl("");setGroupCategory("");setGroupUrlError("");setShowAddGroup(true);}}>
                  <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Добавить группу
                </button>
              </div>
              {(() => {
                const cats = Array.from(new Set(groups.map(g => g.category)));
                return cats.length > 1 ? (
                  <div className="category-filter">
                    <button className={`btn btn-sm ${categoryFilter==="all"?"btn-primary":"btn-secondary"}`} onClick={() => setCategoryFilter("all")}>Все ({groups.length})</button>
                    {cats.map(c => {
                      const count = groups.filter(g => g.category === c).length;
                      return <button key={c} className={`btn btn-sm ${categoryFilter===c?"btn-primary":"btn-secondary"}`} onClick={() => setCategoryFilter(c)}>{c} ({count})</button>;
                    })}
                  </div>
                ) : null;
              })()}
              {groups.length > 0 && (
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
                  <label style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:13,cursor:"pointer"}}>
                    <input type="checkbox" checked={groupSelectedIds.size === groups.filter(g => categoryFilter === "all" || g.category === categoryFilter).length && groupSelectedIds.size > 0} onChange={e => {
                      if (e.target.checked) {
                        const filtered = groups.filter(g => categoryFilter === "all" || g.category === categoryFilter);
                        setGroupSelectedIds(new Set(filtered.map(g => g.id)));
                      } else setGroupSelectedIds(new Set());
                    }} style={{accentColor:"var(--accent)"}}/>
                    <span>Выбрать все</span>
                  </label>
                  {groupSelectedIds.size > 0 && (<>
                    <span style={{fontSize:13,color:"var(--text-muted)"}}>Выбрано: {groupSelectedIds.size}</span>
                    <input className="input" value={groupMoveCategory} onChange={e => setGroupMoveCategory(e.target.value)} placeholder="Новая категория" style={{width:160,fontSize:12,padding:"4px 8px"}} list="move-cat-list"/>
                    <datalist id="move-cat-list">{Array.from(new Set(groups.map(g=>g.category))).map(c=><option key={c} value={c}/>)}</datalist>
                    <button className="btn btn-accent btn-sm" disabled={!groupMoveCategory.trim()} onClick={() => massMoveGroups(groupMoveCategory)}>Переместить</button>
                    <button className="btn btn-danger btn-sm" onClick={() => openConfirmDialog("Удалить выбранные?", `${groupSelectedIds.size} групп будет удалено`, massDeleteGroups)}>Удалить</button>
                  </>)}
                  {user && <button className="btn btn-sm btn-secondary" disabled={loadingFriends} onClick={loadGroupsFriends}>{loadingFriends ? <><span className="spinner"/> Загрузка...</> : "👥 Друзья в группах"}</button>}
                </div>
              )}
              <div className="groups-list">
                {groups.length===0 ? <div className="empty-state"><p>Нет групп</p><button className="btn btn-primary" onClick={() => setShowAddGroup(true)}>Добавить первую группу</button></div> :
                  groups.filter(g => categoryFilter === "all" || g.category === categoryFilter).map((g) => {
                    const cats = Array.from(new Set(groups.map(gr => gr.category)));
                    const timeSince = (dateStr: string | null) => {
                      if (!dateStr) return null;
                      const diff = Date.now() - new Date(dateStr).getTime();
                      const days = Math.floor(diff / 86400000);
                      if (days === 0) return "сегодня";
                      if (days === 1) return "вчера";
                      if (days < 7) return `${days} дн. назад`;
                      return `${Math.floor(days / 7)} нед. назад`;
                    };
                    return (
                      <div key={g.id} className="group-card">
                        <input type="checkbox" checked={groupSelectedIds.has(g.id)} onChange={() => setGroupSelectedIds(prev => { const n = new Set(prev); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })} style={{accentColor:"var(--accent)",width:16,height:16,flexShrink:0,cursor:"pointer"}}/>
                        {g.photo
                          ? <Image src={g.photo} alt="" width={40} height={40} unoptimized style={{borderRadius:10,objectFit:"cover",flexShrink:0}}/>
                          : <div className={`status-dot ${g.status==="ok"?"green":g.status==="error"?"red":"gray"}`}/>}
                        <div className="group-info" style={{flex:1,minWidth:0}}>
                          <div className="group-name"><a href={g.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{color:"inherit",textDecoration:"none"}}>{g.name} <svg viewBox="0 0 24 24" width="12" height="12" style={{opacity:0.4,verticalAlign:"middle"}}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" fill="none" stroke="currentColor" strokeWidth="2"/><polyline points="15 3 21 3 21 9" fill="none" stroke="currentColor" strokeWidth="2"/><line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2"/></svg></a></div>
                          <div className="group-url" style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:12}}>
                            <span>{g.url}</span>
                            {g.members_count > 0 && <span style={{color:"var(--text-muted)"}}>· {g.members_count.toLocaleString("ru-RU")} уч.</span>}
                            {groupFriends[g.url] !== undefined && groupFriends[g.url] > 0 && <span style={{color:"var(--info)",fontWeight:600}}>· 👥 {groupFriends[g.url]} друз.</span>}
                            {g.last_published ? (
                              <span style={{color:"var(--success)"}}>· рассылка {timeSince(g.last_published)} ({g.total_published})</span>
                            ) : (
                              <span style={{color:"var(--text-muted)"}}>· нет рассылок</span>
                            )}
                          </div>
                        </div>
                        <select className="select" value={g.category} onChange={e => changeGroupCategory(g.id, e.target.value)} onClick={e => e.stopPropagation()} style={{width:"auto",minWidth:100,fontSize:12,padding:"4px 8px"}}>
                          {cats.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button className="btn btn-danger btn-sm" onClick={() => openConfirmDialog("Удалить группу?",g.name,() => deleteGroup(g.id))}>
                          <svg viewBox="0 0 24 24" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {tab === "publish" && (
            <PublishPanel posts={posts} groups={groups} selected={publishGroups} setSelected={setPublishGroups}
              postName={publishPost} onSelectPost={setPublishPost} posted={postedGroups?.postName === publishPost ? postedGroups.urls : null}
              busy={publishing} progress={publishProgress} onStart={() => startPublish()} onCancel={cancelPublish}
              onHistory={() => setTab("history")} onAddGroup={() => setShowAddGroup(true)} />
          )}

          {tab === "history" && (
            <PublishHistory batches={history} onRefresh={loadHistory} onRetry={batch => openConfirmDialog(
              "Повторить публикацию?",
              `Текущая версия поста «${batch.postName}» будет отправлена в доступные группы, для которых предыдущая отправка завершилась ошибкой или была пропущена.`,
              () => startPublish(batch),
            )} busy={publishing} loading={historyLoading} error={historyError} />
          )}

          {/* Parser */}
          {tab === "parser" && (
            <div>
              <h1 className="page-title">Парсер групп</h1>
              <div className="parser-search-bar">
                <div style={{display:"flex",gap:8,flex:1}}>
                  <input className="input" value={parserQuery} onChange={e => setParserQuery(e.target.value)} placeholder="Ключевое слово: фотография, бизнес, рецепты, авторынок..." onKeyDown={e => { if(e.key === "Enter") parserSearch(); }} style={{flex:1}}/>
                  <button className="btn btn-primary" disabled={parserSearching || !parserQuery.trim()} onClick={() => parserSearch()}>
                    {parserSearching ? <span className="spinner"/> : <><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Найти</>}
                  </button>
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
                <div style={{position:"relative",maxWidth:300,flex:"0 0 auto"}}>
                  <input className="input" value={parserCity} onChange={e => parserCitySearch(e.target.value)} placeholder="Город (необязательно)" style={{width:"100%"}} onFocus={() => { if (parserCitySuggestions.length > 0) setParserCityOpen(true); }} onBlur={() => setTimeout(() => setParserCityOpen(false), 200)}/>
                  {parserCityId && <button style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:16}} onClick={() => { setParserCity(""); setParserCityId(undefined); setParserCitySuggestions([]); }}>&times;</button>}
                  {parserCityOpen && parserCitySuggestions.length > 0 && (
                    <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:8,marginTop:4,maxHeight:200,overflowY:"auto",boxShadow:"0 4px 12px rgba(0,0,0,0.3)"}}>
                      {parserCitySuggestions.map(c => (
                        <div key={c.id} style={{padding:"8px 12px",cursor:"pointer",fontSize:13,borderBottom:"1px solid var(--border)"}} onMouseDown={() => parserSelectCity(c)}>
                          <span style={{fontWeight:500}}>{c.title}</span>
                          {c.region && <span style={{color:"var(--text-muted)",marginLeft:6}}>{c.region}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
                <input className="input" value={parserCategory} onChange={e => setParserCategory(e.target.value)} placeholder="Категория для добавления" style={{maxWidth:250}} list="parser-cat-list"/>
                <datalist id="parser-cat-list">{Array.from(new Set(groups.map(g=>g.category))).map(c=><option key={c} value={c}/>)}</datalist>
                <input className="input" type="number" min={0} value={parserMembersMin} onChange={e => setParserMembersMin(e.target.value)} placeholder="Уч. от" style={{maxWidth:110}}/>
                <input className="input" type="number" min={0} value={parserMembersMax} onChange={e => setParserMembersMax(e.target.value)} placeholder="Уч. до" style={{maxWidth:110}}/>
                {parserResults.length > 0 && (<>
                  <button className="btn btn-secondary btn-sm" onClick={parserSelectAllOpen}>
                    {parserResults.filter(g => g.is_closed === 0 && !isGroupExisting(g.url) && !isGroupBlacklisted(g.url)).every(g => parserSelectedIds.has(g.id)) && parserResults.some(g => g.is_closed === 0 && !isGroupExisting(g.url) && !isGroupBlacklisted(g.url)) ? "Снять все" : "Выбрать все"}
                  </button>
                  <button className="btn btn-success btn-sm" disabled={parserSelectedIds.size === 0 || parserAddingIds.size > 0} onClick={parserAddSelected}>
                    {parserAddingIds.size > 0 ? <><span className="spinner"/> Добавление...</> : `Добавить выбранные (${parserSelectedIds.size})`}
                  </button>
                </>)}
              </div>
              {(() => {
                const min = Number(parserMembersMin) || 0;
                const max = Number(parserMembersMax) || 0;
                const filtered = parserResults.filter(g => {
                  if (min > 0 && g.members_count < min) return false;
                  if (max > 0 && g.members_count > max) return false;
                  return true;
                });
                return <>
                  {parserResults.length > 0 && (
                    <div style={{fontSize:13,color:"var(--text-muted)",marginBottom:12}}>
                      Найдено: {parserTotal.toLocaleString("ru-RU")} групп
                      {(min > 0 || max > 0) && filtered.length !== parserResults.length && (
                        <span> · показано после фильтра: {filtered.length}</span>
                      )}
                    </div>
                  )}
                  <div className="groups-list">
                    {parserResults.length === 0 && !parserSearching && <div className="empty-state"><p>Введите запрос для поиска групп и сообществ VK</p></div>}
                    {parserSearching && parserResults.length === 0 && <div className="empty-state"><span className="spinner"/></div>}
                    {filtered.map(g => {
                      const existing = getExistingGroup(g.url);
                      const added = isGroupExisting(g.url);
                      const blocked = isGroupBlacklisted(g.url);
                      const disabled = g.is_closed > 0 || added || blocked;
                      return (
                  <div key={g.id} className={`group-card${parserSelectedIds.has(g.id) ? " selected" : ""}`} style={{opacity: g.is_closed ? 0.5 : 1, cursor: disabled ? "default" : "pointer"}} onClick={() => { if (!disabled) parserToggleSelect(g.id); }}>
                    <input type="checkbox" checked={parserSelectedIds.has(g.id)} disabled={disabled} onChange={() => parserToggleSelect(g.id)} onClick={e => e.stopPropagation()} style={{accentColor:"var(--accent)",width:18,height:18,flexShrink:0,cursor:"pointer"}}/>
                    {g.photo && <Image src={g.photo} alt="" width={44} height={44} unoptimized style={{borderRadius:10,objectFit:"cover",flexShrink:0}}/>}
                    <div className="group-info" style={{minWidth:0,flex:1}}>
                      <div className="group-name"><a href={g.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{color:"inherit",textDecoration:"none"}}>{g.name} <svg viewBox="0 0 24 24" width="12" height="12" style={{opacity:0.4,verticalAlign:"middle"}}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" fill="none" stroke="currentColor" strokeWidth="2"/><polyline points="15 3 21 3 21 9" fill="none" stroke="currentColor" strokeWidth="2"/><line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2"/></svg></a></div>
                      <div className="group-url" style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:12}}>
                        <span>{g.members_count.toLocaleString("ru-RU")} участников</span>
                        {g.friends_count !== undefined && g.friends_count > 0 && <span style={{color:"var(--info)",fontWeight:600}}>· 👥 {g.friends_count} друз.</span>}
                        {g.activity && <span style={{color:"var(--accent)"}}>· {g.activity}</span>}
                        {g.is_closed > 0 && <span style={{color:"var(--error)"}}>· закрытая</span>}
                        {g.can_post && <span style={{color:"var(--success)"}}>· можно постить</span>}
                        {!g.can_post && g.can_suggest && <span style={{color:"var(--warning)"}}>· предложка</span>}
                      </div>
                      {g.description && <div style={{fontSize:12,color:"var(--text-muted)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.description}</div>}
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      {blocked ? (
                        <span className="badge badge-error" style={{fontSize:11}}>В чёрном списке</span>
                      ) : existing ? (<>
                        <span className="badge badge-secondary">{existing.category}</span>
                        {existing.total_published > 0 && <span className="badge badge-info" style={{fontSize:11}}>Рассылок: {existing.total_published}</span>}
                        {parserCategory.trim() && parserCategory.trim() !== existing.category && (
                          <button className="btn btn-sm btn-accent" onClick={e => { e.stopPropagation(); parserMoveCategory(g.url, parserCategory.trim()); }} title={`Перенести в "${parserCategory.trim()}"`} style={{fontSize:11,padding:"2px 8px"}}>
                            &rarr; {parserCategory.trim()}
                          </button>
                        )}
                      </>) : parserAddedIds.has(g.id) ? (
                        <span className="badge badge-success">Добавлена</span>
                      ) : parserAddingIds.has(g.id) ? (
                        <span className="spinner"/>
                      ) : null}
                    </div>
                  </div>
                  );
                })}
                  </div>
                </>;
              })()}
              {parserResults.length > 0 && parserResults.length < parserTotal && (
                <div style={{textAlign:"center",marginTop:16}}>
                  <button className="btn btn-secondary" disabled={parserSearching} onClick={() => parserSearch(parserResults.length)}>
                    {parserSearching ? <><span className="spinner"/> Загрузка...</> : "Загрузить ещё"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Logs */}
          {tab === "logs" && (
            <div>
              <div className="toolbar">
                <h1 className="page-title" style={{marginBottom:0}}>Логи</h1>
                <div className="toolbar-spacer"/>
                <div className="log-controls" style={{marginBottom:0}}>
                  {["all","INFO","WARNING","ERROR"].map(l => <button key={l} className={`btn btn-sm btn-secondary${logLevel===l?" active":""}`} onClick={() => setLogLevelState(l)}>{l==="all"?"Все":l}</button>)}
                </div>
                <button className="btn btn-sm btn-secondary" onClick={loadLogs}><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Обновить</button>
                <button className="btn btn-sm btn-danger" onClick={() => openConfirmDialog("Очистить все логи?", "Все логи", async () => { try { await apiFetch("/api/logs", { method: "DELETE" }); setLogs([]); toast("Логи очищены", "success"); } catch { toast("Ошибка очистки логов", "error"); } })}><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Очистить</button>
              </div>
              <div className="log-viewer">
                {logs.length===0 ? <div className="empty-state"><p>Нет логов</p></div> :
                  logs.map((line,i) => { let cls="info"; if(/ERROR/i.test(line))cls="error"; else if(/WARN/i.test(line))cls="warning"; return <div key={i} className={`log-line ${cls}`}>{line}</div>; })}
              </div>
            </div>
          )}
          </div>
        </main>
      </div>

      {/* MODALS */}
      <Modal open={showCreatePost} onClose={() => setShowCreatePost(false)} title="Создать пост">
        <div className="form-group"><label className="form-label">Название поста</label><input className="input" value={postName} onChange={e=>setPostName(e.target.value)} placeholder="my-post"/>{postNameError&&<div className="form-error">{postNameError}</div>}</div>
        <div className="form-group"><label className="form-label">Текст поста</label><textarea className="textarea" value={postText} onChange={e=>setPostText(e.target.value)} placeholder="Введите текст..."/></div>
        <FileDropZone files={postFiles} setFiles={setPostFiles} kind="image"/>
        <FileDropZone files={postVideoFiles} setFiles={setPostVideoFiles} kind="video" label="Видео (до 500 MB)"/>
        {uploadProgress && <UploadProgressBar progress={uploadProgress}/>}
        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowCreatePost(false)}>Отмена</button><button className="btn btn-primary" disabled={creating} onClick={createPost}>{creating?<><span className="spinner"/> {uploadProgress ? "Загрузка..." : "Создание..."}</>:"Создать"}</button></div>
      </Modal>

      <Modal open={showEditPost} onClose={() => setShowEditPost(false)} title="Редактировать пост">
        <div className="form-group"><label className="form-label">Название</label><input className="input" value={editName} disabled style={{opacity:0.6}}/></div>
        <div className="form-group"><label className="form-label">Текст поста</label><textarea className="textarea" value={editText} onChange={e=>setEditText(e.target.value)}/></div>
        <div className="form-group"><label className="form-label">Текущие изображения</label>
          <div className="file-previews">
            {editExistingImages.length===0?<span style={{color:"var(--text-muted)",fontSize:14}}>Нет изображений</span>:
              editExistingImages.map(img => <div key={img} className="file-preview"><Image src={img} alt="" fill sizes="120px" unoptimized style={{objectFit:"cover"}}/><button className="remove-file" onClick={()=>deleteExistingImage(img)}>&times;</button></div>)}
          </div>
        </div>
        <div className="form-group"><label className="form-label">Текущие видео</label>
          <div className="file-previews">
            {editExistingVideos.length===0?<span style={{color:"var(--text-muted)",fontSize:14}}>Нет видео</span>:
              editExistingVideos.map(v => <div key={v} className="file-preview"><video src={v} style={{width:"100%",height:"100%",objectFit:"cover"}}/><button className="remove-file" onClick={()=>deleteExistingVideo(v)}>&times;</button></div>)}
          </div>
        </div>
        <FileDropZone files={editNewFiles} setFiles={setEditNewFiles} kind="image" label="Добавить изображения"/>
        <FileDropZone files={editNewVideoFiles} setFiles={setEditNewVideoFiles} kind="video" label="Добавить видео (до 500 MB)"/>
        {uploadProgress && <UploadProgressBar progress={uploadProgress}/>}
        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowEditPost(false)}>Отмена</button><button className="btn btn-primary" disabled={saving} onClick={saveEditPost}>{saving?<><span className="spinner"/> {uploadProgress ? "Загрузка..." : "Сохранение..."}</>:"Сохранить"}</button></div>
      </Modal>

      <Modal open={showAddGroup} onClose={() => setShowAddGroup(false)} title="Добавить группу">
        <div className="form-group"><label className="form-label">URL группы</label><input className="input" value={groupUrl} onChange={e=>setGroupUrl(e.target.value)} placeholder="https://vk.com/mygroup"/>{groupUrlError&&<div className="form-error">{groupUrlError}</div>}</div>
        <div className="form-group"><label className="form-label">Категория</label><input className="input" value={groupCategory} onChange={e=>setGroupCategory(e.target.value)} placeholder="Авто, Бизнес, ..." list="category-list"/><datalist id="category-list">{Array.from(new Set(groups.map(g=>g.category))).map(c=><option key={c} value={c}/>)}</datalist></div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowAddGroup(false)}>Отмена</button><button className="btn btn-primary" onClick={addGroup}>Добавить</button></div>
      </Modal>

      <Modal open={showBulkGroup} onClose={() => setShowBulkGroup(false)} title="Импорт групп">
        <div className="form-group"><label className="form-label">Категория</label><input className="input" value={bulkCategory} onChange={e=>setBulkCategory(e.target.value)} placeholder="Авто, Бизнес, ..." list="bulk-category-list"/><datalist id="bulk-category-list">{Array.from(new Set(groups.map(g=>g.category))).map(c=><option key={c} value={c}/>)}</datalist></div>
        <div className="form-group"><label className="form-label">Ссылки (по одной на строку)</label><textarea className="textarea" rows={10} value={bulkUrls} onChange={e=>setBulkUrls(e.target.value)} placeholder={"https://vk.com/group1\nhttps://vk.com/group2"}/>{bulkError&&<div className="form-error">{bulkError}</div>}</div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowBulkGroup(false)}>Отмена</button><button className="btn btn-primary" disabled={bulkImporting} onClick={bulkImportGroups}>{bulkImporting?<><span className="spinner"/> Импорт...</>:"Импортировать"}</button></div>
      </Modal>

      <Modal open={showConfirm} onClose={() => setShowConfirm(false)} title={confirmData.title} small>
        <div className="confirm-body"><p><strong>{confirmData.message}</strong> будет удалено.</p></div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowConfirm(false)}>Отмена</button><button className="btn btn-danger" onClick={() => {setShowConfirm(false);confirmData.onConfirm();}}>Удалить</button></div>
      </Modal>

      <Modal open={showSubscribeAllPrompt} onClose={() => setShowSubscribeAllPrompt(false)} title="Подписка на сообщества" small>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <p style={{margin:0,fontSize:14,color:"var(--text-muted)"}}>
            Найдены сообщества, где аккаунт VK не подписан. Отправить подписку сразу на все через API?
          </p>
          <div style={{fontSize:13,color:"var(--text-muted)"}}>
            Сообществ: {getNotSubscribedCommunityUrls().length}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" disabled={joiningCommunities} onClick={() => setShowSubscribeAllPrompt(false)}>Позже</button>
          <button className="btn btn-primary" disabled={joiningCommunities} onClick={async () => {
            const urls = getNotSubscribedCommunityUrls();
            if (urls.length === 0) {
              setShowSubscribeAllPrompt(false);
              return;
            }
            setJoiningCommunities(true);
            try {
              const res = await apiFetch("/api/groups/join-bulk", {
                method: "POST",
                body: JSON.stringify({ urls }),
              });
              const joined = Number((res as { joined?: number }).joined || 0);
              const requested = Number((res as { requested?: number }).requested || 0);
              const failed = Number((res as { failed?: number }).failed || 0);
              const next = requested > 0 ? " После одобрения заявки повторите отправку из истории." :
                joined > 0 ? " Повторите отправку из истории." : "";
              toast(`Вступили: ${joined}, заявок: ${requested}, ошибок: ${failed}.${next}`, failed > 0 ? "warning" : "success");
              setShowSubscribeAllPrompt(false);
            } catch (e) {
              toast(`Ошибка подписки: ${(e as Error).message}`, "error");
            } finally {
              setJoiningCommunities(false);
            }
          }}>{joiningCommunities ? <><span className="spinner"/> Подписка...</> : "Подписаться на все"}</button>
        </div>
      </Modal>

      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast ${t.type}`}><span>{t.message}</span><button className="toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>&times;</button></div>)}
      </div>
    </>
  );
}

/* ===== MODAL ===== */
function BrandMark() {
  return <Image src={brandIcon} alt="" className="brand-mark" width={36} height={36} unoptimized />;
}

function Modal({ open, onClose, title, children, small }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; small?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    element.showModal();
    return () => element.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="modal" aria-labelledby={titleId} style={small ? { width: 400 } : undefined}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="modal-header">
        <h2 className="modal-title" id={titleId}>{title}</h2>
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className="modal-body">{open && children}</div>
    </dialog>
  );
}

/* ===== FILE DROP ZONE ===== */
function FileDropZone({files,setFiles,kind="image",label}: {files:File[];setFiles:(f:File[])=>void;kind?:"image"|"video";label?:string}) {
  const inputId = useId();
  const [dragover,setDragover] = useState(false);
  const accept = kind === "video" ? "video/*" : "image/*";
  const defaultLabel = kind === "video" ? "Видео" : "Изображения";

  // Кэш ObjectURL по File: переиспользуем, чтобы избежать утечки памяти
  // при каждом ре-рендере.
  const previewUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => { previewUrls.forEach((u) => URL.revokeObjectURL(u)); }, [previewUrls]);

  const handleFiles = (fl: FileList) => {
    const filtered = Array.from(fl).filter(f => kind === "video" ? f.type.startsWith("video/") : f.type.startsWith("image/"));
    setFiles([...files, ...filtered]);
  };
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={inputId}>{label || defaultLabel}</label>
      <label className={`drop-zone${dragover?" dragover":""}`} htmlFor={inputId}
        onDragEnter={e=>{e.preventDefault();setDragover(true);}} onDragOver={e=>{e.preventDefault();setDragover(true);}}
        onDragLeave={e=>{e.preventDefault();setDragover(false);}} onDrop={e=>{e.preventDefault();setDragover(false);handleFiles(e.dataTransfer.files);}}>
        <input id={inputId} type="file" multiple accept={accept} onChange={e=>{ if(e.target.files) handleFiles(e.target.files); e.target.value = ""; }}/>
        <span>{kind === "video" ? "Перетащите видео или нажмите" : "Перетащите изображения или нажмите"}</span>
      </label>
      {files.length>0&&<div className="file-previews">
        {files.map((f,i) => (
          <div key={`${f.name}-${f.lastModified}-${i}`} className="file-preview">
            {kind === "video"
              ? <video src={previewUrls[i]} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              : /* eslint-disable-next-line @next/next/no-img-element */
                <img src={previewUrls[i]} alt=""/>}
            <button type="button" aria-label={`Убрать ${f.name}`} className="remove-file" onClick={()=>setFiles(files.filter((_,j)=>j!==i))}>&times;</button>
            <div style={{position:"absolute",bottom:2,left:2,right:2,fontSize:10,background:"rgba(0,0,0,0.6)",color:"#fff",padding:"1px 4px",borderRadius:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
              {(f.size / (1024 * 1024)).toFixed(1)} MB
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}

/* ===== UPLOAD PROGRESS BAR ===== */
function UploadProgressBar({progress}: {progress: {name: string; pct: number}}) {
  return (
    <div style={{margin:"12px 0",padding:"10px 12px",background:"var(--bg-primary)",borderRadius:8,border:"1px solid var(--border)"}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6,gap:12}}>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>{progress.name}</span>
        <span style={{color:"var(--text-muted)",flexShrink:0}}>{Math.round(progress.pct)}%</span>
      </div>
      <div style={{height:6,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${progress.pct}%`,background:"var(--accent)",transition:"width 0.2s"}}/>
      </div>
    </div>
  );
}
