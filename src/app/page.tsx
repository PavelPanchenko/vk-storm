"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { vkGroupPathKey, vkNumericGroupIdFromUrl } from "@/lib/vk-group-url";

async function uploadFile(
  file: File,
  kind: "image" | "video",
  onProgress: (pct: number) => void,
): Promise<{ url: string }> {
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
interface User { user_id: string; name: string; avatar: string }
interface Post { name: string; text: string; image_count: number; images: string[]; videos: string[] }
interface Group { url: string; name: string; category: string; photo: string; members_count: number; status: string; last_published: string | null; total_published: number }
interface ToastItem { id: number; message: string; type: string }
interface Stats {
  total_posts: number; total_groups: number; total_published: number; total_errors: number;
  recent_activity: { level: string; message: string; time: string }[];
}
interface HistoryBatch {
  batchId: string; postName: string; postText: string; createdAt: string;
  totalGroups: number; successCount: number; failedCount: number;
  groups: { groupUrl: string; groupName: string; success: boolean; error: string | null; createdAt: string }[];
}

let toastId = 0;

/* ===== MAIN ===== */
export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [vkToken, setVkToken] = useState("");
  const [tab, setTab] = useState("dashboard");
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
  const [blacklistedUrls, setBlacklistedUrls] = useState<Set<string>>(new Set());

  // Publish
  const [publishPost, setPublishPost] = useState("");
  const [publishGroups, setPublishGroups] = useState<Set<number>>(new Set());
  const [publishFilter, setPublishFilter] = useState<"all" | "new" | "sent">("all");
  const [expandedPubCats, setExpandedPubCats] = useState<Set<string>>(new Set());
  const [postedGroupUrls, setPostedGroupUrls] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState({ progress: 0, status: "", done: false, success: 0, failed: 0, errors: [] as { group: string; error: string; url?: string }[] });
  const [showProgress, setShowProgress] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // History
  const [history, setHistory] = useState<HistoryBatch[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState<Set<string>>(new Set());


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
      setUser(null); setVkToken("");
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
    apiFetch("/api/auth/me").then(d => { setUser(d); setVkToken(d.access_token || ""); setAuthChecked(true); }).catch(() => setAuthChecked(true));
  }, [apiFetch]);

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

    const script = document.createElement("script");
    script.src = "https://unpkg.com/@vkid/sdk@<3.0.0/dist-sdk/umd/index.js";
    script.onload = async () => {
      const VKID = (window as any).VKIDSDK;
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
      .on(VKID.WidgetEvents.ERROR, (err: any) => {
        console.error("VK ID error", err);
        toast("Ошибка авторизации VK ID", "error");
      })
      .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, (payload: any) => {
        const code = payload.code;
        const deviceId = payload.device_id;

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
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch {}
    setUser(null);
  };

  /* ===== DATA LOADING ===== */
  const loadStats = useCallback(async () => { try { setStats(await apiFetch("/api/stats")); } catch {} }, [apiFetch]);
  const loadPosts = useCallback(async () => { try { const d = await apiFetch("/api/posts"); setPosts(Array.isArray(d) ? d : d.posts || []); } catch {} }, [apiFetch]);
  const loadGroups = useCallback(async () => { try { const d = await apiFetch("/api/groups"); setGroups(Array.isArray(d) ? d : d.groups || []); } catch {} }, [apiFetch]);
  const loadLogs = useCallback(async () => { try { const d = await apiFetch(`/api/logs?level=${logLevel}`); setLogs(d.lines || []); } catch {} }, [apiFetch, logLevel]);
  const loadBlacklist = useCallback(async () => { try { const d = await apiFetch("/api/blacklist"); setBlacklistedUrls(new Set((d as { url: string }[]).map((b) => b.url))); } catch {} }, [apiFetch]);
  const loadHistory = useCallback(async () => { try { const d = await apiFetch("/api/publish/history"); setHistory(Array.isArray(d) ? d : []); } catch {} }, [apiFetch]);


  useEffect(() => {
    if (!user) return;
    if (tab === "dashboard") loadStats();
    else if (tab === "posts") loadPosts();
    else if (tab === "groups") loadGroups();
    else if (tab === "logs") loadLogs();
    else if (tab === "parser") { loadGroups(); loadBlacklist(); }
    else if (tab === "publish") { loadPosts(); loadGroups(); }
    else if (tab === "history") loadHistory();
  }, [user, tab, loadStats, loadPosts, loadGroups, loadLogs, loadBlacklist, loadHistory]);

  useEffect(() => {
    if (!publishPost) { setPostedGroupUrls(new Set()); return; }
    apiFetch(`/api/publish/posted-groups?postName=${encodeURIComponent(publishPost)}`)
      .then((urls: string[]) => setPostedGroupUrls(new Set(urls)))
      .catch(() => setPostedGroupUrls(new Set()));
  }, [publishPost, apiFetch]);

  /* ===== POST CRUD ===== */
  const uploadFilesToBlob = useCallback(async (files: File[], _postSlug: string, kind: "image" | "video"): Promise<string[]> => {
    const urls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setUploadProgress({ name: f.name, pct: 0 });
      try {
        const { url } = await uploadFile(f, kind, (pct) => setUploadProgress({ name: f.name, pct }));
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
  }, []);

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

  const deleteGroup = async (index: number) => {
    try { await apiFetch(`/api/groups/${index}`, { method: "DELETE" }); toast("Группа удалена", "success"); loadGroups(); } catch {}
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
    try { toast("Проверка групп...", "info"); await apiFetch("/api/groups/check", { method: "POST" }); toast("Проверка завершена", "success"); loadGroups(); } catch {}
  };

  const changeGroupCategory = async (index: number, category: string) => {
    try {
      await apiFetch(`/api/groups/${index}`, { method: "PATCH", body: JSON.stringify({ category }) });
      loadGroups();
    } catch (e) { toast((e as Error).message, "error"); }
  };

  const massMoveGroups = async (category: string) => {
    if (!category.trim() || groupSelectedIds.size === 0) return;
    const urls = Array.from(groupSelectedIds).map(i => groups[i]?.url).filter(Boolean);
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
    const urls = Array.from(groupSelectedIds).map(i => groups[i]?.url).filter(Boolean);
    try {
      const res = await apiFetch("/api/groups/bulk", { method: "DELETE", body: JSON.stringify({ urls }) });
      toast(`Удалено: ${res.deleted}`, "success");
      setGroups(prev => prev.filter(g => !urls.includes(g.url)));
    } catch (e) { toast((e as Error).message, "error"); }
    setGroupSelectedIds(new Set());
    loadGroups();
  };

  const vkProxyCall = useCallback(async (method: string, params: Record<string, string | number>): Promise<Record<string, unknown>> => {
    const data = await apiFetch("/api/vk/call", { method: "POST", body: JSON.stringify({ method, params }) });
    if (data.error) {
      const err = data.error as Record<string, unknown>;
      throw new Error(`VK API Error ${err.error_code}: ${err.error_msg}`);
    }
    return data.response as Record<string, unknown>;
  }, [apiFetch]);

  const fetchFriendsInGroup = useCallback(async (groupId: string | number): Promise<number> => {
    if (!user) return 0;
    try {
      const resp = await vkProxyCall("groups.getMembers", { group_id: String(groupId), filter: "friends", count: "0" });
      return (resp.count as number) || 0;
    } catch { return 0; }
  }, [user, vkProxyCall]);

  const loadGroupsFriends = async () => {
    if (!user || groups.length === 0) return;
    setLoadingFriends(true);
    const result: Record<string, number> = {};
    for (const g of groups) {
      const screenName = g.url.replace(/\/$/, "").split("/").pop() || "";
      const count = await fetchFriendsInGroup(screenName);
      result[g.url] = count;
      setGroupFriends(prev => ({ ...prev, [g.url]: count }));
      await new Promise(r => setTimeout(r, 350));
    }
    setLoadingFriends(false);
  };

  // Map of existing group URLs to their data for parser cross-check
  const existingGroupUrls = new Map(groups.map(g => [g.url, g]));

  /* ===== PARSER ===== */
  const vkApiFetch = vkProxyCall;

  const parserCitySearch = async (q: string) => {
    setParserCity(q);
    setParserCityId(undefined);
    if (q.trim().length < 2 || !user) { setParserCitySuggestions([]); setParserCityOpen(false); return; }
    try {
      const resp = await vkApiFetch("database.getCities", { country_id: "1", q: q.trim(), need_all: "0", count: "10" });
      const items = ((resp.items || []) as Record<string, unknown>[]).map((c: Record<string, unknown>) => ({ id: c.id as number, title: c.title as string, region: c.region as string | undefined }));
      setParserCitySuggestions(items);
      setParserCityOpen(items.length > 0);
    } catch { setParserCitySuggestions([]); }
  };

  const parserSelectCity = (city: { id: number; title: string; region?: string }) => {
    setParserCity(city.title + (city.region ? `, ${city.region}` : ""));
    setParserCityId(city.id);
    setParserCityOpen(false);
  };

  const parserSearch = async (offset = 0) => {
    if (!parserQuery.trim() || !user) return;
    setParserSearching(true);
    try {
      const params: Record<string, string> = {
        q: parserQuery.trim(),
        count: "40",
        offset: String(offset),
        fields: "members_count,activity,description,can_post,can_suggest,city",
      };
      if (parserCityId) params.city_id = String(parserCityId);
      const resp = await vkApiFetch("groups.search", params);
      const items = ((resp.items || []) as Record<string, unknown>[]).map((g: Record<string, unknown>) => ({
        id: g.id as number,
        name: (g.name as string) || "",
        screen_name: (g.screen_name as string) || "",
        photo: (g.photo_50 || g.photo_100 || "") as string,
        members_count: (g.members_count as number) || 0,
        activity: (g.activity as string) || "",
        description: ((g.description as string) || "").slice(0, 200),
        is_closed: (g.is_closed as number) || 0,
        can_post: Boolean(g.can_post),
        can_suggest: Boolean(g.can_suggest),
        url: `https://vk.com/${(g.screen_name as string) || `club${g.id}`}`,
      }));
      const d = { total: (resp.count as number) || 0, items };
      if (offset === 0) {
        setParserResults(d.items);
        setParserSelectedIds(new Set());
      } else {
        setParserResults(prev => [...prev, ...d.items]);
      }
      setParserTotal(d.total);
      // Fetch friends count in background
      const fetchedItems = offset === 0 ? d.items : d.items;
      (async () => {
        for (const item of fetchedItems) {
          const fc = await fetchFriendsInGroup(item.screen_name || `club${item.id}`);
          setParserResults(prev => prev.map(p => p.id === item.id ? { ...p, friends_count: fc } : p));
          await new Promise(r => setTimeout(r, 350));
        }
      })();
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setParserSearching(false); }
  };

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
    const idx = groups.findIndex(g => g.url === groupUrl);
    if (idx < 0) return;
    try {
      await apiFetch(`/api/groups/${idx}`, { method: "PATCH", body: JSON.stringify({ category: newCategory }) });
      toast("Категория обновлена", "success");
      loadGroups();
    } catch (e) { toast((e as Error).message, "error"); }
  };

  /* ===== PUBLISH ===== */
  const togglePubGroup = (idx: number) => {
    setPublishGroups(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
  };

  const getFilteredIndices = useCallback(() => {
    return groups.map((g, i) => ({ url: g.url, idx: i })).filter(g => {
      if (publishFilter === "new") return !postedGroupUrls.has(g.url);
      if (publishFilter === "sent") return postedGroupUrls.has(g.url);
      return true;
    }).map(g => g.idx);
  }, [groups, publishFilter, postedGroupUrls]);

  const toggleAllPubGroups = (checked: boolean) => {
    const indices = getFilteredIndices();
    setPublishGroups(checked ? new Set(indices) : new Set());
  };

  const publishCancelRef = useRef(false);

  const startPublish = async () => {
    if (!publishPost) { toast("Выберите пост", "warning"); return; }
    if (publishGroups.size === 0) { toast("Выберите группы", "warning"); return; }
    if (!user) { toast("Требуется авторизация", "error"); return; }

    // Get post data
    const post = posts.find(p => p.name === publishPost);
    if (!post) { toast("Пост не найден", "error"); return; }

    const selectedUrls = Array.from(publishGroups).map(i => groups[i]?.url).filter(Boolean);
    if (selectedUrls.length === 0) { toast("Не выбраны группы", "warning"); return; }

    setPublishing(true); setShowProgress(true); setShowResults(false);
    publishCancelRef.current = false;
    const progress = { progress: 0, status: "Проверка групп...", done: false, success: 0, failed: 0, errors: [] as { group: string; error: string; url?: string }[] };
    setPublishProgress({ ...progress });

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const publishResults: { postName: string; groupUrl: string; groupName?: string; success: boolean; error?: string }[] = [];

    try {
      // 1. Batch check groups (groups.getById — comma-separated ids/short names).
      // Сопоставление: по screen_name и по числовому id из club*/public* в URL — иначе
      // при «красивом» адресе сообщества VK вернёт другой screen_name и все группы отфильтруются.
      const screenNameToUrl = new Map(
        selectedUrls.map((u) => [vkGroupPathKey(u), u] as const).filter(([k]) => k.length > 0),
      );
      const idToUrl = new Map<number, string>();
      for (const u of selectedUrls) {
        const nid = vkNumericGroupIdFromUrl(u);
        if (nid != null) idToUrl.set(nid, u);
      }
      const groupsResp = await vkApiFetch("groups.getById", { group_ids: Array.from(screenNameToUrl.keys()).join(","), fields: "can_post,can_suggest" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const groupsList: any[] = (groupsResp as any).groups || (Array.isArray(groupsResp) ? groupsResp : []);
      const validGroups = groupsList.map((g: Record<string, unknown>) => {
        const id = Number(g.id);
        const sn = String(g.screen_name ?? "").toLowerCase();
        const url = screenNameToUrl.get(sn) || idToUrl.get(id) || "";
        return {
          id,
          name: (g.name || g.screen_name) as string,
          url,
          can_post: Boolean(g.can_post),
        };
      }).filter((g) => g.url);

      if (validGroups.length === 0) {
        progress.status = "Нет доступных групп"; progress.done = true;
        setPublishProgress({ ...progress }); setPublishing(false); setShowResults(true);
        return;
      }

      // 2. Upload media ONCE to the user's wall; the resulting photo{owner_id}_{id}
      //    and video{owner_id}_{id} attachments are valid in wall.post for ANY community.
      const hasImages = post.images && post.images.length > 0;
      const hasVideos = post.videos && post.videos.length > 0;
      const sharedAttachments: string[] = [];
      const mediaTotal = (hasImages ? post.images.length : 0) + (hasVideos ? post.videos.length : 0);
      let mediaDone = 0;

      progress.status = "Загрузка медиа...";
      progress.progress = 0;
      setPublishProgress({ ...progress });

      if (hasImages) {
        for (let i = 0; i < post.images.length; i++) {
          if (publishCancelRef.current) break;
          try {
            const serverResp = await vkApiFetch("photos.getWallUploadServer", {});
            const uploadUrl = (serverResp as Record<string, unknown>).upload_url as string;

            const proxyResp = await apiFetch("/api/vk-upload-proxy", {
              method: "POST",
              body: JSON.stringify({ upload_url: uploadUrl, image_url: post.images[i] }),
            });

            if (!proxyResp.photo || proxyResp.photo === "[]") {
              mediaDone++;
              progress.progress = mediaTotal > 0 ? Math.round((mediaDone / mediaTotal) * 30) : 30;
              setPublishProgress({ ...progress });
              continue;
            }

            const saved = await vkApiFetch("photos.saveWallPhoto", {
              server: String(proxyResp.server),
              photo: proxyResp.photo,
              hash: proxyResp.hash,
            });
            const savedArr = Array.isArray(saved) ? saved : ((saved as Record<string, unknown>).items as unknown[] || []);
            if (savedArr.length > 0) {
              const photo = savedArr[0] as Record<string, unknown>;
              sharedAttachments.push(`photo${photo.owner_id}_${photo.id}`);
            }
          } catch (e) {
            progress.errors.push({ group: "—", error: `Фото: ${(e as Error).message}` });
          }
          mediaDone++;
          progress.progress = mediaTotal > 0 ? Math.round((mediaDone / mediaTotal) * 30) : 30;
          setPublishProgress({ ...progress });
          if (i < post.images.length - 1) await new Promise(r => setTimeout(r, 300));
        }
      }

      if (hasVideos) {
        for (let i = 0; i < post.videos.length; i++) {
          if (publishCancelRef.current) break;
          try {
            const vp = await apiFetch("/api/vk-video-upload-proxy", {
              method: "POST",
              body: JSON.stringify({ video_url: post.videos[i], name: publishPost }),
            });
            if (vp.attachment) sharedAttachments.push(vp.attachment);
          } catch (e) {
            progress.errors.push({ group: "—", error: `Видео: ${(e as Error).message}` });
          }
          mediaDone++;
          progress.progress = mediaTotal > 0 ? Math.round((mediaDone / mediaTotal) * 30) : 30;
          setPublishProgress({ ...progress });
        }
      }

      // Если пост задуман с медиа, но ни одно вложение не загрузилось — не публикуем текст молча.
      if (mediaTotal > 0 && sharedAttachments.length === 0 && !publishCancelRef.current) {
        progress.status = "Не удалось загрузить медиа — публикация отменена";
        progress.done = true;
        setPublishProgress({ ...progress });
        setShowResults(true);
        return;
      }

      // 3. Server-side fan-out of wall.post via SSE. Ключ: все wall.post
      //    уходят с одного Lambda-инстанса = один egress IP, и IP-bound
      //    токен не инвалидируется между запросами. Прогресс стримится
      //    обратно событиями SSE.
      const total = validGroups.length;
      progress.status = `Публикация (0/${total})`;
      progress.progress = 30;
      setPublishProgress({ ...progress });

      const abortCtrl = new AbortController();
      const cancelWatcher = setInterval(() => {
        if (publishCancelRef.current) abortCtrl.abort();
      }, 200);

      try {
        const resp = await fetch("/api/publish/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            postText: post.text,
            attachments: sharedAttachments,
            groups: validGroups.map(g => ({ id: g.id, url: g.url, name: g.name })),
          }),
          signal: abortCtrl.signal,
        });

        if (!resp.ok || !resp.body) {
          const errText = await resp.text().catch(() => "");
          throw new Error(`Batch publish failed: ${resp.status} ${errText}`.slice(0, 300));
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          // SSE events separated by blank line
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = chunk.split("\n").find(l => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const event = JSON.parse(dataLine.slice(6));
              if (event.type === "result") {
                if (event.success) {
                  progress.success++;
                  publishResults.push({ postName: publishPost, groupUrl: event.group.url, groupName: event.group.name, success: true });
                } else {
                  progress.failed++;
                  progress.errors.push({ group: event.group.name, error: event.error || "Неизвестная ошибка", url: event.group.url });
                  publishResults.push({ postName: publishPost, groupUrl: event.group.url, groupName: event.group.name, success: false, error: event.error });
                }
                progress.status = `Публикация (${event.completed}/${event.total})`;
                progress.progress = Math.round(30 + (event.completed / event.total) * 70);
                setPublishProgress({ ...progress });
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
      } catch (e) {
        if (!publishCancelRef.current) {
          progress.errors.push({ group: "—", error: `Ошибка стрима: ${(e as Error).message}` });
        }
      } finally {
        clearInterval(cancelWatcher);
      }

      const cancelled = publishCancelRef.current;
      if (cancelled) {
        progress.status = "Отменено";
      } else {
        progress.progress = 100;
        progress.status = "Готово!";
      }
      progress.done = true;
      setPublishProgress({ ...progress });
      setShowResults(true);

      // Сохраняем даже частичные результаты при отмене — юзеру полезно видеть, что успело уйти
      if (publishResults.length > 0) {
        try {
          await apiFetch("/api/publish/results", { method: "POST", body: JSON.stringify({ batchId, postText: post.text, results: publishResults }) });
        } catch {}
      }
    } catch (e) {
      progress.status = `Ошибка: ${(e as Error).message}`; progress.done = true;
      setPublishProgress({ ...progress }); setShowResults(true);
    } finally {
      setPublishing(false);
    }
  };


  const openConfirmDialog = (title: string, message: string, onConfirm: () => void) => {
    setConfirmData({ title, message, onConfirm }); setShowConfirm(true);
  };

  /* ===== RENDER ===== */
  if (!authChecked) return null;

  if (!user) {
    return (
      <div id="login-screen">
        <div className="login-card">
          <div className="login-logo">VK <span>Storm</span></div>
          <p className="login-subtitle">Автоматическая публикация в группы VK</p>
          <div ref={vkOneTapRef} style={{width:"100%"}} />
        </div>
      </div>
    );
  }

  return (
    <>
      <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
        <svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      {sidebarOpen && <div className="sidebar-overlay open" onClick={() => setSidebarOpen(false)} />}

      <div className="app-layout">
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sidebar-header"><div className="sidebar-brand">VK <span>Storm</span></div></div>
          <nav className="sidebar-nav">
            {([
              ["dashboard", "Главная", <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>],
              ["posts", "Посты", <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>],
              ["groups", "Группы", <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>],
              ["publish", "Публикация", <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>],
              ["history", "История", <><polyline points="12 8 12 12 14 14"/><circle cx="12" cy="12" r="10"/></>],
              ["parser", "Парсер", <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>],
              ["logs", "Логи", <><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>],
            ] as [string, string, React.ReactNode][]).map(([id, label, icon]) => (
              <div key={id} className={`nav-item${tab === id ? " active" : ""}`} onClick={() => { setTab(id); setSidebarOpen(false); }}>
                <svg viewBox="0 0 24 24">{icon}</svg>{label}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="user-info">
              {user.avatar && <img className="user-avatar" src={user.avatar} alt="" />}
              <div className="user-name">{user.name || "Пользователь"}</div>
            </div>
            <button className="logout-btn" onClick={logout}>Выйти</button>
          </div>
        </aside>

        <main className="main-content">
          {/* Dashboard */}
          {tab === "dashboard" && (
            <div>
              <h1 className="page-title">Главная</h1>
              <div className="stats-grid">
                {[["blue","Всего постов",stats?.total_posts],["green","Всего групп",stats?.total_groups],["orange","Опубликовано",stats?.total_published],["red","Ошибки",stats?.total_errors]].map(([cls,label,val]) => (
                  <div key={cls as string} className={`stat-card ${cls}`}><div className="stat-label">{label as string}</div><div className="stat-value">{val ?? "--"}</div></div>
                ))}
              </div>
              <h2 className="page-title" style={{fontSize:18}}>Последняя активность</h2>
              <div className="activity-list">
                {!stats?.recent_activity?.length ? <div className="empty-state"><p>Нет данных</p></div> :
                  stats.recent_activity.map((a,i) => {
                    const c: Record<string,string> = {success:"var(--success)",error:"var(--error)",warning:"var(--warning)",info:"var(--accent)"};
                    return <div key={i} className="activity-item"><div className="activity-dot" style={{background:c[a.level]||c.info}}/><span>{a.message}</span><span className="activity-time">{a.time}</span></div>;
                  })}
              </div>
            </div>
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
                    <div key={p.name} className="post-card">
                      <div className="post-card-header">
                        <div className="post-card-title">{p.name}</div>
                        <div style={{display:"flex",gap:4}}>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditPost(p.name)} title="Редактировать">
                            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => openConfirmDialog("Удалить пост?",p.name,() => deletePost(p.name))}>
                            <svg viewBox="0 0 24 24" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </div>
                      <div className="post-card-text">{p.text ? (p.text.length>100?p.text.slice(0,100)+"...":p.text) : <em style={{color:"var(--text-muted)"}}>Нет текста</em>}</div>
                      <div className="post-card-footer" style={{display:"flex",gap:6}}><span className="badge badge-info">{p.image_count} изобр.</span>{p.videos?.length > 0 && <span className="badge badge-accent">{p.videos.length} видео</span>}</div>
                    </div>
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
                        const filtered = groups.map((g, i) => ({ g, i })).filter(({ g }) => categoryFilter === "all" || g.category === categoryFilter);
                        setGroupSelectedIds(new Set(filtered.map(({ i }) => i)));
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
                {groups.length===0 ? <div className="empty-state"><p>Нет групп</p></div> :
                  groups.filter(g => categoryFilter === "all" || g.category === categoryFilter).map((g) => {
                    const realIndex = groups.indexOf(g);
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
                      <div key={realIndex} className="group-card">
                        <input type="checkbox" checked={groupSelectedIds.has(realIndex)} onChange={() => setGroupSelectedIds(prev => { const n = new Set(prev); if (n.has(realIndex)) n.delete(realIndex); else n.add(realIndex); return n; })} style={{accentColor:"var(--accent)",width:16,height:16,flexShrink:0,cursor:"pointer"}}/>
                        {g.photo ? <img src={g.photo} alt="" style={{width:40,height:40,borderRadius:10,objectFit:"cover",flexShrink:0}}/> : <div className={`status-dot ${g.status==="ok"?"green":g.status==="error"?"red":"gray"}`}/>}
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
                        <select className="select" value={g.category} onChange={e => changeGroupCategory(realIndex, e.target.value)} onClick={e => e.stopPropagation()} style={{width:"auto",minWidth:100,fontSize:12,padding:"4px 8px"}}>
                          {cats.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button className="btn btn-danger btn-sm" onClick={() => openConfirmDialog("Удалить группу?",g.name,() => deleteGroup(realIndex))}>
                          <svg viewBox="0 0 24 24" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Publish */}
          {tab === "publish" && (
            <div>
              <h1 className="page-title">Публикация</h1>
              <div className="publish-section">
                <div className="publish-section-title">Выберите пост</div>
                <select className="select" value={publishPost} onChange={e => setPublishPost(e.target.value)}>
                  <option value="">-- Выберите пост --</option>
                  {posts.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="publish-section">
                <div className="publish-section-title">Выберите группы</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12,alignItems:"center"}}>
                  {(() => {
                    const fi = getFilteredIndices();
                    const allChecked = fi.length > 0 && fi.every(i => publishGroups.has(i));
                    return <label className="checkbox-item" style={{display:"inline-flex",width:"auto"}}>
                      <input type="checkbox" checked={allChecked} onChange={e => toggleAllPubGroups(e.target.checked)}/><span>Выбрать все</span>
                    </label>;
                  })()}
                  {(() => {
                    const fi = new Set(getFilteredIndices());
                    const cats = Array.from(new Set(groups.map(g => g.category)));
                    return cats.length > 1 ? cats.map(cat => {
                      const catIndices = groups.map((g, i) => g.category === cat ? i : -1).filter(i => i >= 0 && fi.has(i));
                      if (catIndices.length === 0) return null;
                      const allSelected = catIndices.every(i => publishGroups.has(i));
                      return (
                        <label key={cat} className="checkbox-item" style={{display:"inline-flex",width:"auto"}}>
                          <input type="checkbox" checked={allSelected} onChange={() => {
                            setPublishGroups(prev => {
                              const next = new Set(prev);
                              if (allSelected) catIndices.forEach(i => next.delete(i));
                              else catIndices.forEach(i => next.add(i));
                              return next;
                            });
                          }}/><span>{cat} ({catIndices.length})</span>
                        </label>
                      );
                    }) : null;
                  })()}
                  {publishPost && (
                    <select className="input" value={publishFilter} onChange={e => { setPublishFilter(e.target.value as "all" | "new" | "sent"); setPublishGroups(new Set()); }} style={{width:"auto",fontSize:13,padding:"4px 8px",marginLeft:"auto"}}>
                      <option value="all">Все группы</option>
                      <option value="new">Не отправлялось ({groups.filter(g => !postedGroupUrls.has(g.url)).length})</option>
                      <option value="sent">Уже отправлено ({groups.filter(g => postedGroupUrls.has(g.url)).length})</option>
                    </select>
                  )}
                </div>
                {groups.length===0 ? <p style={{color:"var(--text-muted)",fontSize:14}}>Нет групп</p> :
                  (() => {
                    const filtered = groups.map((g, i) => ({...g, idx: i})).filter(g => {
                      if (publishFilter === "new") return !postedGroupUrls.has(g.url);
                      if (publishFilter === "sent") return postedGroupUrls.has(g.url);
                      return true;
                    });
                    const cats = Array.from(new Set(filtered.map(g => g.category)));
                    return cats.length === 0 ? <p style={{color:"var(--text-muted)",fontSize:14}}>Нет групп по фильтру</p> : cats.map(cat => {
                      const catGroups = filtered.filter(g => g.category === cat);
                      const expanded = expandedPubCats.has(cat);
                      const selectedCount = catGroups.filter(g => publishGroups.has(g.idx)).length;
                      return (
                        <div key={cat} style={{marginBottom:12}}>
                          <button type="button" onClick={() => setExpandedPubCats(prev => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })} style={{display:"flex",alignItems:"center",gap:6,width:"100%",background:"transparent",border:"none",padding:"6px 0",cursor:"pointer",color:"var(--text-muted)",fontSize:13,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",textAlign:"left"}}>
                            <svg viewBox="0 0 24 24" width="14" height="14" style={{transform:expanded?"rotate(90deg)":"rotate(0)",transition:"transform 0.15s",flexShrink:0}}><polyline points="9 18 15 12 9 6" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
                            <span>{cat}</span>
                            <span style={{opacity:0.7,fontWeight:500,textTransform:"none",letterSpacing:0}}>({selectedCount > 0 ? `${selectedCount}/${catGroups.length}` : catGroups.length})</span>
                          </button>
                          {expanded && (
                            <div className="checkbox-grid">
                              {catGroups.map(g => <label key={g.idx} className="checkbox-item"><input type="checkbox" checked={publishGroups.has(g.idx)} onChange={() => togglePubGroup(g.idx)}/><span>{g.name}</span><a href={g.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{color:"var(--text-muted)",opacity:0.5,marginLeft:2,lineHeight:1}} title="Открыть в VK"><svg viewBox="0 0 24 24" width="11" height="11"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" fill="none" stroke="currentColor" strokeWidth="2"/><polyline points="15 3 21 3 21 9" fill="none" stroke="currentColor" strokeWidth="2"/><line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2"/></svg></a></label>)}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()
                }
              </div>
              <div style={{marginBottom:24,display:"flex",gap:8}}>
                <button className="btn btn-primary" disabled={publishing} onClick={startPublish}>
                  {publishing ? <><span className="spinner"/> Публикация...</> : <><svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Опубликовать</>}
                </button>
                {publishing && <button className="btn btn-danger" onClick={() => { publishCancelRef.current = true; }}>Отменить</button>}
              </div>
              {showProgress && <div className="progress-section active">
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <span className="progress-text">{publishProgress.status}</span><span className="progress-percent">{publishProgress.progress}%</span>
                </div>
                <div className="progress-bar-track"><div className="progress-bar-fill" style={{width:`${publishProgress.progress}%`}}/></div>
              </div>}
              {showResults && <div className="results-section active">
                <div className="publish-section-title">Результаты</div>
                <div className="results-summary">
                  <div className="result-badge success">Успешно: {publishProgress.success}</div>
                  <div className="result-badge failed">Ошибки: {publishProgress.failed}</div>
                </div>
                {publishProgress.errors.length>0 && <div className="error-list">
                  {publishProgress.errors.map((e,i) => <div key={i} className="error-card"><div className="error-card-group">{e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" style={{color:"inherit"}}>{e.group} ↗</a> : e.group}</div><div className="error-card-msg">{e.error}</div></div>)}
                  <button className="btn btn-danger" style={{marginTop:"12px"}} onClick={() => {
                    const failedUrls = publishProgress.errors.map(e => e.url).filter(Boolean) as string[];
                    if (failedUrls.length === 0) return;
                    openConfirmDialog("Удалить и заблокировать проблемные группы?", `${failedUrls.length} групп будут удалены и добавлены в чёрный список, чтобы не добавлять их повторно.`, async () => {
                      try {
                        await apiFetch("/api/groups/bulk", { method: "DELETE", body: JSON.stringify({ urls: failedUrls }) });
                        await apiFetch("/api/blacklist", { method: "POST", body: JSON.stringify({ urls: failedUrls, reason: "Публикация невозможна" }) });
                        toast(`Удалено и заблокировано ${failedUrls.length} групп`, "success");
                        setPublishProgress(prev => ({ ...prev, errors: [], failed: 0 }));
                        loadGroups();
                      } catch { toast("Ошибка при удалении", "error"); }
                    });
                  }}>Удалить и заблокировать ({publishProgress.errors.length})</button>
                </div>}
              </div>}

            </div>
          )}

          {/* History */}
          {tab === "history" && (
            <div>
              <div className="toolbar">
                <h1 className="page-title" style={{marginBottom:0}}>История публикаций</h1>
                <div className="toolbar-spacer"/>
                <button className="btn btn-sm btn-secondary" onClick={loadHistory}><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Обновить</button>
              </div>
              {history.length === 0 ? (
                <div className="empty-state"><p>Нет истории публикаций</p></div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {history.map(batch => {
                    const expanded = historyExpanded.has(batch.batchId);
                    const date = new Date(batch.createdAt);
                    return (
                      <div key={batch.batchId} style={{background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
                        <div style={{padding:"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:12}} onClick={() => setHistoryExpanded(prev => { const n = new Set(prev); if (n.has(batch.batchId)) n.delete(batch.batchId); else n.add(batch.batchId); return n; })}>
                          <svg viewBox="0 0 24 24" width="16" height="16" style={{transform:expanded?"rotate(90deg)":"rotate(0)",transition:"transform 0.2s",flexShrink:0,color:"var(--text-muted)"}}><polyline points="9 18 15 12 9 6"/></svg>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:600,fontSize:15}}>{batch.postName}</div>
                            <div style={{fontSize:12,color:"var(--text-muted)",marginTop:2}}>
                              {date.toLocaleString("ru-RU")} &middot; {batch.totalGroups} групп
                            </div>
                          </div>
                          <div style={{display:"flex",gap:8,flexShrink:0}}>
                            <span className="result-badge success" style={{fontSize:12}}>{batch.successCount}</span>
                            {batch.failedCount > 0 && <span className="result-badge failed" style={{fontSize:12}}>{batch.failedCount}</span>}
                          </div>
                        </div>
                        {expanded && (
                          <div style={{borderTop:"1px solid var(--border)",padding:"12px 18px"}}>
                            {batch.postText && (
                              <div style={{padding:"10px 14px",background:"var(--bg)",borderRadius:8,marginBottom:12,fontSize:13,color:"var(--text-muted)",whiteSpace:"pre-wrap",maxHeight:120,overflow:"auto"}}>
                                {batch.postText}
                              </div>
                            )}
                            <div style={{display:"flex",flexDirection:"column",gap:4}}>
                              {batch.groups.map((g, i) => (
                                <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:6,background: g.success ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)"}}>
                                  <div style={{width:8,height:8,borderRadius:"50%",background:g.success?"var(--success)":"var(--error)",flexShrink:0}}/>
                                  <a href={g.groupUrl} target="_blank" rel="noopener noreferrer" style={{flex:1,fontSize:13,fontWeight:500,color:"inherit",textDecoration:"none"}}>{g.groupName || g.groupUrl} <svg viewBox="0 0 24 24" width="11" height="11" style={{opacity:0.4,verticalAlign:"middle"}}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" fill="none" stroke="currentColor" strokeWidth="2"/><polyline points="15 3 21 3 21 9" fill="none" stroke="currentColor" strokeWidth="2"/><line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2"/></svg></a>
                                  {g.error && <span style={{fontSize:11,color:"var(--error)",maxWidth:300,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.error}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
                    <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:8,marginTop:4,maxHeight:200,overflowY:"auto",boxShadow:"0 4px 12px rgba(0,0,0,0.3)"}}>
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
                {parserResults.length > 0 && (<>
                  <button className="btn btn-secondary btn-sm" onClick={parserSelectAllOpen}>
                    {parserResults.filter(g => g.is_closed === 0 && !isGroupExisting(g.url) && !isGroupBlacklisted(g.url)).every(g => parserSelectedIds.has(g.id)) && parserResults.some(g => g.is_closed === 0 && !isGroupExisting(g.url) && !isGroupBlacklisted(g.url)) ? "Снять все" : "Выбрать все"}
                  </button>
                  <button className="btn btn-success btn-sm" disabled={parserSelectedIds.size === 0 || parserAddingIds.size > 0} onClick={parserAddSelected}>
                    {parserAddingIds.size > 0 ? <><span className="spinner"/> Добавление...</> : `Добавить выбранные (${parserSelectedIds.size})`}
                  </button>
                </>)}
              </div>
              {parserResults.length > 0 && <div style={{fontSize:13,color:"var(--text-muted)",marginBottom:12}}>Найдено: {parserTotal.toLocaleString("ru-RU")} групп</div>}
              <div className="groups-list">
                {parserResults.length === 0 && !parserSearching && <div className="empty-state"><p>Введите запрос для поиска групп и сообществ VK</p></div>}
                {parserSearching && parserResults.length === 0 && <div className="empty-state"><span className="spinner"/></div>}
                {parserResults.map(g => {
                  const existing = getExistingGroup(g.url);
                  const added = isGroupExisting(g.url);
                  const blocked = isGroupBlacklisted(g.url);
                  const disabled = g.is_closed > 0 || added || blocked;
                  return (
                  <div key={g.id} className={`group-card${parserSelectedIds.has(g.id) ? " selected" : ""}`} style={{opacity: g.is_closed ? 0.5 : 1, cursor: disabled ? "default" : "pointer"}} onClick={() => { if (!disabled) parserToggleSelect(g.id); }}>
                    <input type="checkbox" checked={parserSelectedIds.has(g.id)} disabled={disabled} onChange={() => parserToggleSelect(g.id)} onClick={e => e.stopPropagation()} style={{accentColor:"var(--accent)",width:18,height:18,flexShrink:0,cursor:"pointer"}}/>
                    {g.photo && <img src={g.photo} alt="" style={{width:44,height:44,borderRadius:10,objectFit:"cover",flexShrink:0}}/>}
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
                <button className="btn btn-sm btn-danger" onClick={async () => { if (!confirm("Очистить все логи?")) return; try { await apiFetch("/api/logs", { method: "DELETE" }); setLogs([]); toast("Логи очищены"); } catch { toast("Ошибка очистки логов"); } }}><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Очистить</button>
              </div>
              <div className="log-viewer">
                {logs.length===0 ? <div className="empty-state"><p>Нет логов</p></div> :
                  logs.map((line,i) => { let cls="info"; if(/ERROR/i.test(line))cls="error"; else if(/WARN/i.test(line))cls="warning"; return <div key={i} className={`log-line ${cls}`}>{line}</div>; })}
              </div>
            </div>
          )}
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
              editExistingImages.map(img => <div key={img} className="file-preview"><img src={img} alt=""/><button className="remove-file" onClick={()=>deleteExistingImage(img)}>&times;</button></div>)}
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

      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast ${t.type}`}><span>{t.message}</span><button className="toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>&times;</button></div>)}
      </div>
    </>
  );
}

/* ===== MODAL ===== */
function Modal({open,onClose,title,children,small}: {open:boolean;onClose:()=>void;title:string;children:React.ReactNode;small?:boolean}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop open" onClick={e => {if(e.target===e.currentTarget)onClose();}}>
      <div className="modal" style={small?{width:400}:undefined}>
        <div className="modal-header"><div className="modal-title">{title}</div><button className="modal-close" onClick={onClose}><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ===== FILE DROP ZONE ===== */
function FileDropZone({files,setFiles,kind="image",label}: {files:File[];setFiles:(f:File[])=>void;kind?:"image"|"video";label?:string}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragover,setDragover] = useState(false);
  const accept = kind === "video" ? "video/*" : "image/*";
  const defaultLabel = kind === "video" ? "Видео" : "Изображения";
  const handleFiles = (fl: FileList) => {
    const filtered = Array.from(fl).filter(f => kind === "video" ? f.type.startsWith("video/") : f.type.startsWith("image/"));
    setFiles([...files, ...filtered]);
  };
  return (
    <div className="form-group">
      <label className="form-label">{label || defaultLabel}</label>
      <div className={`drop-zone${dragover?" dragover":""}`} onClick={()=>inputRef.current?.click()}
        onDragEnter={e=>{e.preventDefault();setDragover(true);}} onDragOver={e=>{e.preventDefault();setDragover(true);}}
        onDragLeave={e=>{e.preventDefault();setDragover(false);}} onDrop={e=>{e.preventDefault();setDragover(false);handleFiles(e.dataTransfer.files);}}>
        <input ref={inputRef} type="file" multiple accept={accept} onChange={e=>e.target.files&&handleFiles(e.target.files)}/>
        <p>{kind === "video" ? "Перетащите видео или нажмите" : "Перетащите изображения или нажмите"}</p>
      </div>
      {files.length>0&&<div className="file-previews">
        {files.map((f,i) => (
          <div key={i} className="file-preview">
            {kind === "video"
              ? <video src={URL.createObjectURL(f)} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              : <img src={URL.createObjectURL(f)} alt=""/>}
            <button className="remove-file" onClick={()=>setFiles(files.filter((_,j)=>j!==i))}>&times;</button>
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
    <div style={{margin:"12px 0",padding:"10px 12px",background:"var(--bg)",borderRadius:8,border:"1px solid var(--border)"}}>
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
