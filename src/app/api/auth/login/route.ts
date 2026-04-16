import { NextResponse } from "next/server";
import { createAuthRequest } from "@/lib/auth";

export async function GET() {
  const { url, cookiePayload } = createAuthRequest();
  const resp = NextResponse.redirect(url);
  resp.cookies.set("vk_auth", JSON.stringify(cookiePayload), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600, // 10 min
    path: "/",
  });
  return resp;
}
