import { setTimeout as sleep } from "node:timers/promises";

/** Минимальный интервал между вызовами api.vk.com для одной сессии (~2.5 req/s). */
const VK_MIN_GAP_MS = 400;

const chains = new Map<string, Promise<unknown>>();

/**
 * Сериализует VK API-вызовы по sessionId с паузой между ними,
 * чтобы снизить частоту Error 6 (Too many requests per second).
 */
export async function vkRateLimited<T>(sessionId: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const prev = chains.get(sessionId) ?? Promise.resolve();
  const run = prev
    .catch(() => {})
    .then(async () => {
      await sleep(VK_MIN_GAP_MS, undefined, { signal });
      return work();
    });
  const tail = run.then(() => {}, () => {});
  chains.set(sessionId, tail);
  void tail.then(() => { if (chains.get(sessionId) === tail) chains.delete(sessionId); });
  return run;
}
