import { NextRequest, NextResponse } from "next/server";
import { VK_REDIRECT_URI } from "@/lib/config";
import { applyVkSession, completeVkLogin } from "@/lib/vk-login";

export async function GET(request: NextRequest) {
  const destination = new URL("/", VK_REDIRECT_URI || request.url);
  const { searchParams } = request.nextUrl;
  const result = await completeVkLogin(request, {
    code: searchParams.get("code"),
    state: searchParams.get("state"),
    deviceId: searchParams.get("device_id"),
  });

  if (result.error) {
    destination.searchParams.set("auth_error", searchParams.has("error") ? "vk_declined" : result.error);
    return NextResponse.redirect(destination);
  }
  return applyVkSession(NextResponse.redirect(destination), result);
}
