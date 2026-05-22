import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { searchGroups } from "@/lib/vk-discovery";
import { appendLog } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const count = Math.min(Number(searchParams.get("count")) || 20, 100);
  const offset = Number(searchParams.get("offset")) || 0;
  const cityId = searchParams.get("city_id") ? Number(searchParams.get("city_id")) : undefined;

  if (!query.trim()) {
    return NextResponse.json({ detail: "Параметр q обязателен" }, { status: 400 });
  }

  try {
    const data = await searchGroups(auth.sessionId, auth.session, query.trim(), count, offset, cityId);
    return NextResponse.json(data);
  } catch (e) {
    appendLog("ERROR", `Group search error: ${e}`);
    return NextResponse.json(
      { detail: `Ошибка поиска: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
