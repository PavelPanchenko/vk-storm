import { Session, updateSessionTokens, getSession } from "./sessions";
import { refreshTokens } from "./auth";
import { appendLog } from "./logger";

const VK_API_VERSION = "5.199";
const MAX_TRANSIENT_RETRIES = 3;

type VKError = { error_code: number; error_msg: string };
type VKResponse = { response?: unknown; error?: VKError };

async function rawCall(token: string, method: string, params: Record<string, string | number>): Promise<VKResponse> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    form.append(k, String(v));
  }
  form.set("access_token", token);
  form.set("v", VK_API_VERSION);

  const resp = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return resp.json();
}

// Process-scope lock so concurrent callers with the same sessionId don't all
// fire refresh_token at once. The first one refreshes; the rest await and
// pick up the resulting session.
const refreshLocks = new Map<string, Promise<Session | null>>();

async function refreshSessionShared(sessionId: string, staleToken: string, fallback: Session): Promise<Session | null> {
  const existing = refreshLocks.get(sessionId);
  if (existing) return existing;

  const promise = (async (): Promise<Session | null> => {
    // Another caller may have finished refreshing while we waited; re-read DB.
    const fresh = await getSession(sessionId);
    if (fresh && fresh.access_token !== staleToken) return fresh;

    const refreshToken = fresh?.refresh_token || fallback.refresh_token;
    const deviceId = fresh?.device_id || fallback.device_id;
    if (!refreshToken) return null;

    const tokenData = await refreshTokens(refreshToken, deviceId);
    if (tokenData.error || !tokenData.access_token) {
      await appendLog("ERROR", `Token refresh failed: ${JSON.stringify(tokenData)}`);
      return null;
    }
    await updateSessionTokens(sessionId, tokenData);
    return (await getSession(sessionId)) ?? null;
  })();

  refreshLocks.set(sessionId, promise);
  try {
    return await promise;
  } finally {
    refreshLocks.delete(sessionId);
  }
}

function backoffDelay(attempt: number): number {
  // 400, 900, 1600 ms + jitter
  return 400 + attempt * 500 + Math.floor(Math.random() * 300);
}

/**
 * Calls a VK API method with:
 *   - auto-refresh on Error 5 (IP-bound token) via a per-session mutex so
 *     concurrent callers don't stampede the refresh endpoint,
 *   - exponential backoff retry on Error 10 ("could not check access_token now")
 *     and Error 6 (rate limit) — common after a sibling refresh invalidates
 *     the old token server-side.
 *   - between transient retries we re-read the session from DB in case a
 *     sibling caller already refreshed it.
 */
export async function vkMethod(
  sessionId: string,
  session: Session,
  method: string,
  params: Record<string, string | number>,
): Promise<{ data: VKResponse; session: Session }> {
  let currentSession = session;
  let refreshed = false;
  let data: VKResponse = {};

  for (let transientAttempt = 0; transientAttempt <= MAX_TRANSIENT_RETRIES; transientAttempt++) {
    data = await rawCall(currentSession.access_token, method, params);
    const errCode = data.error?.error_code;

    if (errCode === 5) {
      if (refreshed) return { data, session: currentSession };
      refreshed = true;
      await appendLog("WARNING", `VK Error 5 on ${method}, refreshing token...`);
      const next = await refreshSessionShared(sessionId, currentSession.access_token, currentSession);
      if (!next) return { data, session: currentSession };
      currentSession = next;
      transientAttempt = -1; // reset: refresh doesn't count as a transient retry
      continue;
    }

    if (errCode === 10 || errCode === 6) {
      if (transientAttempt >= MAX_TRANSIENT_RETRIES) return { data, session: currentSession };
      await appendLog("WARNING", `VK Error ${errCode} on ${method}, retry ${transientAttempt + 1}/${MAX_TRANSIENT_RETRIES}`);
      await new Promise(r => setTimeout(r, backoffDelay(transientAttempt)));
      // A sibling caller may have refreshed the token meanwhile.
      const fresh = await getSession(sessionId);
      if (fresh) currentSession = fresh;
      continue;
    }

    return { data, session: currentSession };
  }

  return { data, session: currentSession };
}
