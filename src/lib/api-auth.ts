import { cookies } from "next/headers";
import { getSession, updateSessionTokens, deleteSession, Session } from "./sessions";
import { refreshTokens } from "./auth";
import { appendLog } from "./logger";
import { NextResponse } from "next/server";

const EXPIRY_GRACE_MS = 60 * 1000;

function unauthorized(reason: string): NextResponse {
  const resp = NextResponse.json({ detail: "Не авторизован", reason }, { status: 401 });
  resp.cookies.delete("session_id");
  return resp;
}

export async function requireSession(): Promise<
  { error: NextResponse; session?: undefined; sessionId?: undefined }
  | { error?: undefined; session: Session; sessionId: string }
> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session_id")?.value;
  if (!sessionId) return { error: unauthorized("no_cookie") };

  let session = await getSession(sessionId);
  if (!session) return { error: unauthorized("no_session") };

  if (session.expires_at - EXPIRY_GRACE_MS < Date.now()) {
    if (!session.refresh_token) {
      await deleteSession(sessionId);
      await appendLog("INFO", `Session ${sessionId.slice(0, 8)} expired, no refresh token`);
      return { error: unauthorized("expired") };
    }
    try {
      const tokenData = await refreshTokens(session.refresh_token, session.device_id);
      if (tokenData.error || !tokenData.access_token) {
        await deleteSession(sessionId);
        await appendLog("WARNING", `Refresh failed: ${JSON.stringify(tokenData)}`);
        return { error: unauthorized("refresh_failed") };
      }
      await updateSessionTokens(sessionId, tokenData);
      session = (await getSession(sessionId))!;
      await appendLog("INFO", `Session ${sessionId.slice(0, 8)} refreshed`);
    } catch (e) {
      await deleteSession(sessionId);
      await appendLog("ERROR", `Refresh error: ${e}`);
      return { error: unauthorized("refresh_error") };
    }
  }

  return { session, sessionId };
}

export async function requireAccessToken() {
  const result = await requireSession();
  if (result.error) return result;
  return { ...result, accessToken: result.session.access_token };
}
