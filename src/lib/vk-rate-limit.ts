/** Минимальный интервал между вызовами api.vk.com для одной сессии (~2.5 req/s). */
const VK_MIN_GAP_MS = 400;

const chains = new Map<string, Promise<unknown>>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Сериализует VK API-вызовы по sessionId с паузой между ними,
 * чтобы снизить частоту Error 6 (Too many requests per second).
 */
export async function vkRateLimited<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
  const prev = chains.get(sessionId) ?? Promise.resolve();
  const run = prev
    .catch(() => {})
    .then(async () => {
      await sleep(VK_MIN_GAP_MS);
      return work();
    });
  chains.set(sessionId, run.then(() => {}, () => {}));
  return run;
}
