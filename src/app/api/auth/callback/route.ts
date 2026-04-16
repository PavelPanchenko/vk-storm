import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getUserInfo, AuthCookiePayload } from "@/lib/auth";
import { createSession } from "@/lib/sessions";
import { appendLog } from "@/lib/logger";
import { VK_REDIRECT_URI } from "@/lib/config";

function getBaseUrl(): string {
  // Derive origin from the configured redirect URI (works behind ngrok)
  const url = new URL(VK_REDIRECT_URI);
  return url.origin;
}

export async function GET(request: NextRequest) {
  const base = getBaseUrl();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const deviceId = searchParams.get("device_id") || "";
  const error = searchParams.get("error");
  const errorDesc = searchParams.get("error_description");

  if (error) {
    await appendLog("ERROR", `VK ID OAuth error: ${error} — ${errorDesc}`);
    return NextResponse.redirect(`${base}/?auth_error=${encodeURIComponent(errorDesc || error)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${base}/?auth_error=missing_code`);
  }

  // Read PKCE data from cookie (set by /api/auth/login for manual redirect flow)
  // OneTap SDK redirect flow won't have this cookie — exchange without PKCE
  const authCookie = request.cookies.get("vk_auth")?.value;
  let codeVerifier = "";

  if (authCookie) {
    let payload: AuthCookiePayload;
    try {
      payload = JSON.parse(authCookie);
    } catch {
      return NextResponse.redirect(`${base}/?auth_error=invalid_state`);
    }

    if (payload.state !== state) {
      return NextResponse.redirect(`${base}/?auth_error=invalid_state`);
    }
    codeVerifier = payload.codeVerifier;
  }

  const tokenData = await exchangeCode(code, deviceId, codeVerifier);

  if (tokenData.error) {
    await appendLog("ERROR", `VK ID token exchange error: ${JSON.stringify(tokenData)}`);
    return NextResponse.redirect(`${base}/?auth_error=${encodeURIComponent(String(tokenData.error_description || tokenData.error))}`);
  }

  // Log full token response for debugging scope issues
  await appendLog("DEBUG", `VK ID token response: ${JSON.stringify(tokenData)}`);

  const accessToken = tokenData.access_token as string;
  if (!accessToken) {
    return NextResponse.redirect(`${base}/?auth_error=no_token`);
  }

  const userInfo = await getUserInfo(accessToken);
  const sessionId = await createSession(tokenData, userInfo, deviceId);

  const firstName = (userInfo.first_name as string) || "";
  const lastName = (userInfo.last_name as string) || "";
  await appendLog("INFO", `User logged in via VK ID: ${firstName} ${lastName} (id=${tokenData.user_id})`);

  const resp = NextResponse.redirect(base);
  resp.cookies.set("session_id", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 86400 * 30,
  });
  // Clean up auth cookie
  resp.cookies.delete("vk_auth");
  return resp;
}
