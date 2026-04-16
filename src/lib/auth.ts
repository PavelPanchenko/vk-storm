import crypto from "crypto";
import { VK_APP_ID, VK_APP_SECRET, VK_REDIRECT_URI } from "./config";

const VK_ID_AUTHORIZE = "https://id.vk.com/authorize";
const VK_ID_TOKEN = "https://id.vk.com/oauth2/auth";
const VK_USER_INFO_URL = "https://api.vk.com/method/users.get";

// Extended scopes — requires business account verification in VK ID
const VK_SCOPE = "wall photos groups";

/* ===== PKCE helpers ===== */

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/* ===== Auth request (cookie-based) ===== */

export interface AuthCookiePayload {
  state: string;
  codeVerifier: string;
}

export function createAuthRequest(): { url: string; cookiePayload: AuthCookiePayload } {
  const state = crypto.randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: VK_APP_ID,
    redirect_uri: VK_REDIRECT_URI,
    scope: VK_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    url: `${VK_ID_AUTHORIZE}?${params}`,
    cookiePayload: { state, codeVerifier },
  };
}

/* ===== Token exchange ===== */

export async function exchangeCode(
  code: string,
  deviceId: string,
  codeVerifier: string,
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    client_id: VK_APP_ID,
    client_secret: VK_APP_SECRET,
    redirect_uri: VK_REDIRECT_URI,
    device_id: deviceId,
  };
  if (codeVerifier) {
    params.code_verifier = codeVerifier;
  }
  const body = new URLSearchParams(params);

  const resp = await fetch(VK_ID_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return resp.json();
}

/* ===== Refresh token ===== */

export async function refreshTokens(
  refreshToken: string,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: VK_APP_ID,
    client_secret: VK_APP_SECRET,
  };
  if (deviceId) params.device_id = deviceId;

  const resp = await fetch(VK_ID_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return resp.json();
}

/* ===== User info ===== */

export async function getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    access_token: accessToken,
    v: "5.199",
    fields: "photo_100,first_name,last_name",
  });
  const resp = await fetch(`${VK_USER_INFO_URL}?${params}`);
  const data = await resp.json();
  const users = data.response || [];
  return users[0] || {};
}
