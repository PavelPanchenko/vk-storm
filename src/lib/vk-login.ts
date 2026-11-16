import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { type NextRequest, type NextResponse } from "next/server";
import { exchangeCode, getUserInfo } from "./auth";
import { VK_APP_SECRET } from "./config";
import { db } from "./db";
import { sessions } from "./db/schema";
import { appendLog } from "./logger";
import { createSession, getSession } from "./sessions";

const statePattern = /^[0-9a-f]{32}$/;
const secure = process.env.NODE_ENV === "production";
const loginCookie = { path: "/api/auth", httpOnly: true, sameSite: "lax" as const, secure, maxAge: 1800 };

const flowCookieName = (state: string) => `vk_auth_${state}`;

function signature(value: string) {
  return createHmac("sha256", VK_APP_SECRET).update(value).digest("hex");
}

export function setVkLoginContext(response: NextResponse, state: string, verifier: string) {
  const payload = `${verifier}.${Date.now() + loginCookie.maxAge * 1000}`;
  response.cookies.set(flowCookieName(state), `${payload}.${signature(`vk-login:${state}:${payload}`)}`, loginCookie);
}

function readVerifier(request: NextRequest, state: string) {
  const raw = request.cookies.get(flowCookieName(state))?.value;
  const match = raw?.match(/^([A-Za-z0-9_-]{43})\.(\d{13})\.([0-9a-f]{64})$/);
  if (!match || Number(match[2]) < Date.now()) return null;
  const [, verifier, expiresAt, mac] = match;
  const expected = signature(`vk-login:${state}:${verifier}.${expiresAt}`);
  return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex")) ? verifier : null;
}

type LoginResult = { sessionId: string; state?: string; error?: never }
  | { error: "invalid_state" | "missing_code" | "vk_exchange_failed" | "vk_unavailable"; sessionId?: never };

export async function completeVkLogin(request: NextRequest, input: { code?: unknown; state?: unknown; deviceId?: unknown }): Promise<LoginResult> {
  const { state, code } = input;
  const verifier = typeof state === "string" && statePattern.test(state) ? readVerifier(request, state) : null;
  if (!verifier || typeof state !== "string") {
    const sessionId = request.cookies.get("session_id")?.value;
    if (sessionId && await getSession(sessionId)) return { sessionId };
    return { error: "invalid_state" };
  }
  if (typeof code !== "string" || !code) return { error: "missing_code" };

  const sessionId = signature(`vk-session:${state}:${verifier}:${code}`);
  const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
  try {
    const result = await db.transaction(async tx => {
      // OneTap and the redirect can arrive on different Vercel instances.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`);
      const [existing] = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).limit(1);
      if (existing) return { reused: true } as const;

      const token = await exchangeCode(code, deviceId, verifier, state);
      const accessToken = token.access_token;
      if (token.error || typeof accessToken !== "string" || !accessToken ||
          !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0 ||
          (token.state != null && token.state !== state)) {
        return { rejected: true } as const;
      }

      // Once the one-time code has been exchanged, a failed avatar lookup must not discard the login.
      const profile = await getUserInfo(accessToken).catch(() => ({}));
      const userId = String(token.user_id || ("id" in profile ? profile.id : "") || "");
      if (!/^[1-9]\d*$/.test(userId)) return { rejected: true } as const;
      await createSession(tx, sessionId, token, profile, deviceId);
      return { userId } as const;
    });

    if (result.rejected) return { error: "vk_exchange_failed" };
    if (result.userId) {
      await appendLog("INFO", "Вход через VK ID", result.userId)
        .catch(() => console.error("Failed to record VK login"));
    }
    return { sessionId, state };
  } catch (error) {
    console.error("VK login could not complete", error instanceof Error ? error.name : "UnknownError");
    return { error: "vk_unavailable" };
  }
}

export function applyVkSession(response: NextResponse, result: Extract<LoginResult, { sessionId: string }>) {
  if (!result.state) return response;
  response.cookies.set("session_id", result.sessionId, {
    path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: 86400 * 30,
  });
  response.cookies.set(flowCookieName(result.state), "", { ...loginCookie, maxAge: 0 });
  return response;
}
