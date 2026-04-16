import { NextRequest, NextResponse } from "next/server";
import { getUserInfo } from "@/lib/auth";
import { createSession } from "@/lib/sessions";
import { appendLog } from "@/lib/logger";
import { VK_APP_ID, VK_APP_SECRET, VK_REDIRECT_URI } from "@/lib/config";

const VK_ID_TOKEN = "https://id.vk.com/oauth2/auth";

/**
 * Receives authorization code from VK ID OneTap SDK
 * and exchanges it for tokens on the server side.
 * This ensures the access token is bound to the server's IP.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { code, device_id, code_verifier } = body;

  if (!code) {
    return NextResponse.json({ error: "no_code" }, { status: 400 });
  }

  await appendLog("DEBUG", `VK ID OneTap code received, exchanging on server...`);

  // Exchange code for tokens on the server
  const tokenParams: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    client_id: VK_APP_ID,
    client_secret: VK_APP_SECRET,
    device_id: device_id || "",
    redirect_uri: VK_REDIRECT_URI,
  };
  if (code_verifier) {
    tokenParams.code_verifier = code_verifier;
  }
  const tokenBody = new URLSearchParams(tokenParams);

  const tokenResp = await fetch(VK_ID_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });
  const tokenData = await tokenResp.json();

  if (tokenData.error) {
    await appendLog("ERROR", `VK ID token exchange error: ${JSON.stringify(tokenData)}`);
    return NextResponse.json({ error: tokenData.error_description || tokenData.error }, { status: 400 });
  }

  const accessToken = tokenData.access_token as string;
  if (!accessToken) {
    return NextResponse.json({ error: "no_token" }, { status: 400 });
  }

  await appendLog("DEBUG", `VK ID token obtained on server for user_id=${tokenData.user_id}`);

  const userInfo = await getUserInfo(accessToken);
  const sessionId = await createSession(tokenData, userInfo, device_id || "");

  const firstName = (userInfo.first_name as string) || "";
  const lastName = (userInfo.last_name as string) || "";
  await appendLog("INFO", `User logged in via VK ID OneTap: ${firstName} ${lastName} (id=${tokenData.user_id})`);

  const resp = NextResponse.json({ ok: true });
  resp.cookies.set("session_id", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 86400 * 30,
  });
  return resp;
}
