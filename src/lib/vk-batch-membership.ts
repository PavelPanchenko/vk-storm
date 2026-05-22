import type { Session } from "./sessions";
import { vkMethod } from "./vk-method";

const EXECUTE_BATCH = 25;

function isMemberValue(response: unknown): boolean {
  if (typeof response === "number") return response === 1;
  if (response && typeof response === "object" && "member" in response) {
    const member = (response as { member?: unknown }).member;
    return member === 1 || member === true;
  }
  return false;
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
): Promise<{ map: Map<number, boolean>; session: Session }> {
  const map = new Map<number, boolean>();
  let currentSession = session;
  if (groupIds.length === 0) return { map, session: currentSession };

  for (let i = 0; i < groupIds.length; i += EXECUTE_BATCH) {
    const batch = groupIds.slice(i, i + EXECUTE_BATCH);
    const lines = batch.map(
      (gid) => `results.push(API.groups.isMember({"group_id":${gid},"user_id":"${userId}"}));`,
    );
    const code = `var results = [];\n${lines.join("\n")}\nreturn results;`;

    const { data, session: nextSession } = await vkMethod(sessionId, currentSession, "execute", { code });
    currentSession = nextSession;
    if (data.error) {
      for (const gid of batch) map.set(gid, false);
      continue;
    }
    const items = Array.isArray(data.response) ? data.response : [];
    batch.forEach((gid, j) => {
      map.set(gid, isMemberValue(items[j]));
    });
  }

  return { map, session: currentSession };
}
