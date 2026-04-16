import { NextRequest, NextResponse } from "next/server";
import { requireAccessToken } from "@/lib/api-auth";
import { VKClient } from "@/lib/vk-client";

export async function GET(request: NextRequest) {
  const result = await requireAccessToken();
  if (result.error) return result.error;

  const query = request.nextUrl.searchParams.get("q") || "";
  if (!query.trim()) {
    return NextResponse.json({ items: [] });
  }

  try {
    const vk = new VKClient(result.accessToken!);
    const items = await vk.searchCities(query.trim());
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
