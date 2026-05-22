import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { friendsInGroupsBatch } from "@/lib/vk-discovery";

/**
 * Пакетный подсчёт друзей пользователя в каждой группе из списка.
 * Принимает { groupIds: string[] } — VK id или screen_name каждой группы.
 * Возвращает { counts: Record<groupId, number> }.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => ({}))) as { groupIds?: unknown };
  const ids = Array.isArray(body.groupIds)
    ? body.groupIds.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 500)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ counts: {} });
  }

  const map = await friendsInGroupsBatch(auth.sessionId, auth.session, ids);
  const counts: Record<string, number> = {};
  for (const [k, v] of map) counts[k] = v;
  return NextResponse.json({ counts });
}
