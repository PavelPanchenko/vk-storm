import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { vkMethod } from "@/lib/vk-method";
import { vkGroupPathKey } from "@/lib/vk-group-url";

type JoinResult = {
  url: string;
  success: boolean;
  status?: "joined" | "requested";
  error?: string;
};

function parseJoinStatus(response: unknown): "joined" | "requested" | null {
  if (response === 1 || response === true) return "joined";
  if (response === 2) return "requested";
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const urls = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0) : [];
  if (urls.length === 0) {
    return NextResponse.json({ detail: "Список URL пуст" }, { status: 400 });
  }

  let joined = 0;
  let requested = 0;
  let failed = 0;
  const results: JoinResult[] = [];

  for (const url of urls) {
    const groupKey = vkGroupPathKey(url);
    if (!groupKey) {
      failed++;
      results.push({ url, success: false, error: "Не удалось определить сообщество из URL" });
      continue;
    }

    const { data } = await vkMethod(auth.sessionId, auth.session, "groups.join", { group_id: groupKey });
    if (data.error) {
      failed++;
      results.push({
        url,
        success: false,
        error: `Error ${data.error.error_code}: ${data.error.error_msg}`,
      });
      continue;
    }

    const status = parseJoinStatus(data.response);
    if (status === "joined") {
      joined++;
      results.push({ url, success: true, status });
      continue;
    }
    if (status === "requested") {
      requested++;
      results.push({ url, success: true, status });
      continue;
    }

    failed++;
    results.push({ url, success: false, error: "Неожиданный ответ VK API" });
  }

  return NextResponse.json({
    joined,
    requested,
    failed,
    results,
  });
}
