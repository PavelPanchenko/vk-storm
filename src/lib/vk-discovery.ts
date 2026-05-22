import type { Session } from "./sessions";
import { appendLog } from "./logger";
import { vkMethod } from "./vk-method";
import { vkGroupPathKey } from "./vk-group-url";

const CHECK_BATCH = 25;

export type CheckedGroup = {
  url: string;
  status: "ok" | "error";
  name?: string;
  id?: string;
  can_post?: boolean;
  photo?: string;
  members_count?: number;
  error?: string;
};

export async function searchCities(
  sessionId: string,
  session: Session,
  query: string,
  countryId = 1,
): Promise<{ id: number; title: string; region?: string }[]> {
  const { data } = await vkMethod(sessionId, session, "database.getCities", {
    country_id: String(countryId),
    q: query,
    need_all: "0",
    count: "10",
  });
  if (data.error) return [];
  const resp = (data.response as Record<string, unknown>) || {};
  const items = (resp.items as Record<string, unknown>[]) || [];
  return items.map((c) => ({
    id: c.id as number,
    title: c.title as string,
    region: c.region as string | undefined,
  }));
}

export type VkGroupSearchItem = {
  id: number;
  name: string;
  screen_name: string;
  photo: string;
  members_count: number;
  activity: string;
  description: string;
  is_closed: number;
  can_post: boolean;
  can_suggest: boolean;
  url: string;
};

export async function searchGroups(
  sessionId: string,
  session: Session,
  query: string,
  count = 20,
  offset = 0,
  cityId?: number,
): Promise<{ total: number; items: VkGroupSearchItem[] }> {
  const params: Record<string, string> = {
    q: query,
    count: String(count),
    offset: String(offset),
    fields: "members_count,activity,description,can_post,can_suggest,city",
  };
  if (cityId) params.city_id = String(cityId);

  const { data } = await vkMethod(sessionId, session, "groups.search", params);
  if (data.error) {
    throw new Error(`Error ${data.error.error_code}: ${data.error.error_msg}`);
  }
  const resp = (data.response as Record<string, unknown>) || {};
  const raw = (resp.items as Record<string, unknown>[]) || [];

  const items: VkGroupSearchItem[] = raw.map((g) => ({
    id: Number(g.id),
    name: (g.name as string) || "",
    screen_name: (g.screen_name as string) || "",
    photo: (g.photo_50 as string) || (g.photo_100 as string) || "",
    members_count: (g.members_count as number) || 0,
    activity: (g.activity as string) || "",
    description: ((g.description as string) || "").slice(0, 200),
    is_closed: (g.is_closed as number) || 0,
    can_post: Boolean(g.can_post),
    can_suggest: Boolean(g.can_suggest),
    url: `https://vk.com/${(g.screen_name as string) || `club${g.id}`}`,
  }));

  return { total: (resp.count as number) || 0, items };
}

/**
 * Пакетная проверка групп через execute (25 в одном запросе).
 * Не падает целиком, если упал отдельный батч — помечает группы статусом error.
 */
export async function checkGroups(
  sessionId: string,
  session: Session,
  groupUrls: string[],
): Promise<CheckedGroup[]> {
  const results: CheckedGroup[] = [];

  for (let i = 0; i < groupUrls.length; i += CHECK_BATCH) {
    const batch = groupUrls.slice(i, i + CHECK_BATCH);
    const screenNames = batch.map((u) => vkGroupPathKey(u));
    const lines = screenNames.map(
      (sn, idx) =>
        `var r${idx} = API.groups.getById({"group_id":"${sn}","fields":"can_post,can_suggest,photo_200,members_count"});\nresults.push(r${idx});`,
    );
    const code = `var results = [];\n${lines.join("\n")}\nreturn results;`;

    const { data } = await vkMethod(sessionId, session, "execute", { code });
    if (data.error) {
      const err = `Error ${data.error.error_code}: ${data.error.error_msg}`;
      appendLog("ERROR", `checkGroups batch failed: ${err}`);
      for (const url of batch) results.push({ url, status: "error", error: err });
      continue;
    }

    const items = (data.response as (Record<string, unknown> | false)[]) || [];
    for (let j = 0; j < batch.length; j++) {
      const raw = items[j];
      if (!raw) {
        results.push({ url: batch[j], status: "error", error: "VK вернул пустой ответ" });
        continue;
      }
      const groupArr = Array.isArray(raw)
        ? raw
        : ((raw as Record<string, unknown>).groups as Record<string, unknown>[]) || [];
      const gi = (groupArr[0] || {}) as Record<string, unknown>;
      results.push({
        url: batch[j],
        name: (gi.name as string) || screenNames[j],
        id: String(gi.id),
        status: "ok",
        can_post: Boolean(gi.can_post),
        photo: (gi.photo_200 as string) || "",
        members_count: (gi.members_count as number) || 0,
      });
    }
  }

  return results;
}

/**
 * Считает количество друзей пользователя в каждой группе одним execute-батчем.
 */
export async function friendsInGroupsBatch(
  sessionId: string,
  session: Session,
  groupIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (groupIds.length === 0) return map;

  for (let i = 0; i < groupIds.length; i += CHECK_BATCH) {
    const batch = groupIds.slice(i, i + CHECK_BATCH);
    const lines = batch.map(
      (gid) =>
        `results.push(API.groups.getMembers({"group_id":"${gid}","filter":"friends","count":0}).count);`,
    );
    const code = `var results = [];\n${lines.join("\n")}\nreturn results;`;
    const { data } = await vkMethod(sessionId, session, "execute", { code });
    if (data.error) {
      for (const gid of batch) map.set(gid, 0);
      continue;
    }
    const items = Array.isArray(data.response) ? data.response : [];
    batch.forEach((gid, j) => {
      map.set(gid, typeof items[j] === "number" ? (items[j] as number) : 0);
    });
  }

  return map;
}
