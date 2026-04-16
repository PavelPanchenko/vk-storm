import { NextRequest, NextResponse } from "next/server";
import { requireAccessToken } from "@/lib/api-auth";
import { VKClient } from "@/lib/vk-client";
import { appendLog } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const result = await requireAccessToken();
  if (result.error) return result.error;

  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const count = Math.min(Number(searchParams.get("count")) || 20, 100);
  const offset = Number(searchParams.get("offset")) || 0;
  const cityId = searchParams.get("city_id") ? Number(searchParams.get("city_id")) : undefined;

  if (!query.trim()) {
    return NextResponse.json({ detail: "Параметр q обязателен" }, { status: 400 });
  }

  try {
    const vk = new VKClient(result.accessToken!);
    const data = await vk.searchGroups(query.trim(), count, offset, cityId);

    const items = data.items.map((g) => ({
      id: g.id,
      name: g.name || "",
      screen_name: g.screen_name || "",
      photo: g.photo_50 || g.photo_100 || "",
      members_count: g.members_count || 0,
      activity: g.activity || "",
      description: ((g.description as string) || "").slice(0, 200),
      is_closed: g.is_closed || 0,
      can_post: Boolean(g.can_post),
      can_suggest: Boolean(g.can_suggest),
      url: `https://vk.com/${g.screen_name || `club${g.id}`}`,
    }));

    return NextResponse.json({ total: data.total, items });
  } catch (e) {
    appendLog("ERROR", `Group search error: ${e}`);
    return NextResponse.json(
      { detail: `Ошибка поиска: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}
