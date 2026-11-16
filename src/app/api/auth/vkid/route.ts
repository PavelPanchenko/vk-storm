import { NextRequest, NextResponse } from "next/server";
import { createAuthRequest, VK_SCOPE } from "@/lib/auth";
import { VK_APP_ID, VK_REDIRECT_URI } from "@/lib/config";
import { applyVkSession, completeVkLogin, setVkLoginContext } from "@/lib/vk-login";

export function GET() {
  const { state, codeVerifier, codeChallenge } = createAuthRequest();
  const response = NextResponse.json({
    app: Number(VK_APP_ID), redirectUrl: VK_REDIRECT_URI, scope: VK_SCOPE, state, codeChallenge,
  }, { headers: { "Cache-Control": "no-store" } });
  setVkLoginContext(response, state, codeVerifier);
  return response;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const result = await completeVkLogin(request, { code: body?.code, state: body?.state, deviceId: body?.device_id });
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.error === "vk_unavailable" ? 502 : 400 });
  }
  return applyVkSession(NextResponse.json({ ok: true }), result);
}
