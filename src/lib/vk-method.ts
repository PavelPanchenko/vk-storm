import { Session, updateSessionTokens, getSession } from "./sessions";
import { refreshTokens } from "./auth";
import { appendLog } from "./logger";

const VK_API_VERSION = "5.199";

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

/**
 * Calls a VK API method with automatic token refresh on Error 5
 * ("access_token was given to another ip address" / expired).
 * VK ID tokens are IP-bound; on Vercel Fluid Compute the egress IP can
 * differ from the one the token was issued to. We refresh and retry once.
 */
export async function vkMethod(
  sessionId: string,
  session: Session,
  method: string,
  params: Record<string, string | number>,
): Promise<{ data: VKResponse; session: Session }> {
  let currentSession = session;
  let data = await rawCall(currentSession.access_token, method, params);

  if (data.error?.error_code === 5 && currentSession.refresh_token) {
    await appendLog("WARNING", `VK Error 5 on ${method}, refreshing token...`);
    const tokenData = await refreshTokens(currentSession.refresh_token, currentSession.device_id);
    if (tokenData.error || !tokenData.access_token) {
      await appendLog("ERROR", `Token refresh failed on Error 5: ${JSON.stringify(tokenData)}`);
      return { data, session: currentSession };
    }
    await updateSessionTokens(sessionId, tokenData);
    const refreshed = await getSession(sessionId);
    if (refreshed) currentSession = refreshed;
    await appendLog("INFO", `Token refreshed after Error 5, retrying ${method}`);
    data = await rawCall(currentSession.access_token, method, params);
  }

  return { data, session: currentSession };
}
