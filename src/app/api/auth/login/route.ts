import { NextResponse } from "next/server";
import { createAuthRequest } from "@/lib/auth";
import { setVkLoginContext } from "@/lib/vk-login";

export function GET() {
  const { url, state, codeVerifier } = createAuthRequest();
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  setVkLoginContext(response, state, codeVerifier);
  return response;
}
