import type { Session } from "./sessions";
import { vkMethod } from "./vk-method";

const EXECUTE_BATCH = 25;

export function parseVkMembership(response: unknown): boolean | undefined {
  const member = response && typeof response === "object" && "member" in response ? response.member : response;
  if (member === 1 || member === true) return true;
  if (member === 0 || member === false) return false;
  return undefined;
}

/**
 * Проверяет подписку на группы одним или несколькими execute-запросами
 * вместо groups.isMember на каждую группу при публикации.
 * Возвращает обновлённую сессию, если внутри vkMethod произошёл refresh токена.
 */
export async function fetchGroupMembershipMap(
  sessionId: string,
  session: Session,
  userId: string,
  groupIds: number[],
  signal?: AbortSignal,
): Promise<{ map: Map<number, boolean>; session: Session }> {
  const map = new Map<number, boolean>();
  let currentSession = session;
  if (groupIds.length === 0) return { map, session: currentSession };

  for (let i = 0; i < groupIds.length; i += EXECUTE_BATCH) {
    const batch = groupIds.slice(i, i + EXECUTE_BATCH);
    const lines = batch.map(
      (gid) => `results.push(API.groups.isMember(${JSON.stringify({ group_id: gid, user_id: userId })}));`,
    );
    const code = `var results = [];\n${lines.join("\n")}\nreturn results;`;

    try {
      const { data, session: nextSession } = await vkMethod(sessionId, currentSession, "execute", { code }, signal);
      currentSession = nextSession;
      if (data.error || !Array.isArray(data.response)) continue;
      const items: unknown[] = data.response;
      batch.forEach((gid, j) => {
        // execute uses false to mark a failed API call; groups.isMember returns 0.
        if (items[j] === false) return;
        const member = parseVkMembership(items[j]);
        if (member !== undefined) map.set(gid, member);
      });
    } catch (error) {
      signal?.throwIfAborted();
      console.warn("VK membership lookup failed", error instanceof Error ? error.name : "UnknownError");
    }
  }

  return { map, session: currentSession };
}
