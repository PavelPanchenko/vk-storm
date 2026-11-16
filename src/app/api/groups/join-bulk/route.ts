import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readGroups } from "@/lib/groups";
import { parseVkMembership } from "@/lib/vk-batch-membership";
import { vkGroupPathKey, vkNumericGroupIdFromUrl } from "@/lib/vk-group-url";
import { vkMethod } from "@/lib/vk-method";

type JoinResult = {
  url: string;
  success: boolean;
  status?: "joined" | "requested";
  error?: string;
};

export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body: unknown = await request.json().catch(() => null);
  const input = (body as { urls?: unknown } | null)?.urls;
  const urls = Array.isArray(input) ? [...new Set(input.filter((url): url is string => typeof url === "string" && Boolean(url.trim())))] : [];
  if (urls.length === 0) return NextResponse.json({ detail: "Список URL пуст" }, { status: 400 });

  const savedUrls = new Set(await readGroups(auth.session.user_id));
  const results: JoinResult[] = [];
  let session = auth.session;

  for (const url of urls) {
    try {
      if (!savedUrls.has(url)) throw new Error("Сообщество отсутствует в вашем списке");
      let groupId = vkNumericGroupIdFromUrl(url);
      if (!groupId) {
        const key = vkGroupPathKey(url);
        if (!key) throw new Error("Не удалось определить сообщество из URL");
        const lookup = await vkMethod(auth.sessionId, session, "groups.getById", { group_ids: key });
        session = lookup.session;
        if (lookup.data.error) throw new Error(`VK ${lookup.data.error.error_code}: ${lookup.data.error.error_msg}`);
        const payload = lookup.data.response as { groups?: { id: number }[] } | { id: number }[] | undefined;
        const groups = Array.isArray(payload) ? payload : payload?.groups;
        groupId = groups?.[0]?.id ?? null;
      }
      if (groupId === null || !Number.isSafeInteger(groupId) || groupId <= 0) {
        throw new Error("VK не вернул числовой ID сообщества");
      }

      const join = await vkMethod(auth.sessionId, session, "groups.join", { group_id: groupId });
      session = join.session;
      if (join.data.error) throw new Error(`VK ${join.data.error.error_code}: ${join.data.error.error_msg}`);
      if (join.data.response !== 1 && join.data.response !== true && join.data.response !== 2) {
        throw new Error("VK не подтвердил вступление или отправку заявки");
      }

      const check = await vkMethod(auth.sessionId, session, "groups.isMember", {
        group_id: groupId, user_id: auth.session.user_id, extended: 1,
      });
      session = check.session;
      const membership = check.data.response as { member?: unknown; request?: unknown } | undefined;
      if (parseVkMembership(membership) === true) {
        results.push({ url, success: true, status: "joined" });
      } else if (parseVkMembership(membership?.request) === true || join.data.response === 2) {
        results.push({ url, success: true, status: "requested" });
      } else {
        throw new Error("VK принял запрос, но статус вступления пока неизвестен. Проверьте его в сообществе");
      }
    } catch (error) {
      results.push({ url, success: false, error: (error as Error).message });
    }
  }

  return NextResponse.json({
    joined: results.filter(item => item.status === "joined").length,
    requested: results.filter(item => item.status === "requested").length,
    failed: results.filter(item => !item.success).length,
    results,
  });
}
