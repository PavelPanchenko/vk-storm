import { NextResponse } from "next/server";
import { VK_APP_ID, VK_REDIRECT_URI } from "@/lib/config";

export async function GET() {
  return NextResponse.json({ vk_app_id: Number(VK_APP_ID), redirect_uri: VK_REDIRECT_URI });
}
