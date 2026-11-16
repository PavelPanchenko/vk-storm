import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { publishBatches, publishResults } from "./db/schema";

const now = sql`now()`;

export async function closePublishBatches(userId: string, batchId?: string) {
  // Expiring the batch and its queued rows together prevents a late worker
  // from claiming a group after it has been made available for retry.
  await db.transaction(async tx => {
    const runs = await tx.update(publishBatches).set({ completedAt: now }).where(and(
      eq(publishBatches.userId, userId),
      isNull(publishBatches.completedAt),
      batchId ? eq(publishBatches.id, batchId) : sql`${publishBatches.heartbeatAt} < now() - interval '5 minutes'`,
    )).returning({ id: publishBatches.id });
    if (runs.length === 0) return;

    const results = and(eq(publishResults.userId, userId), inArray(publishResults.batchId, runs.map(run => run.id)));
    await tx.update(publishResults).set({ status: "skipped" }).where(and(results, eq(publishResults.status, "queued")));
    await tx.update(publishResults).set({ status: "unknown" }).where(and(results, eq(publishResults.status, "sending")));
  });
}

export async function heartbeatPublishBatch(batchId: string) {
  const [active] = await db.update(publishBatches).set({ heartbeatAt: now })
    .where(and(eq(publishBatches.id, batchId), isNull(publishBatches.completedAt)))
    .returning({ id: publishBatches.id });
  return Boolean(active);
}

export async function claimPublishDestination(userId: string, batchId: string, url: string, name: string) {
  return db.transaction(async tx => {
    const [active] = await tx.update(publishBatches).set({ heartbeatAt: now })
      .where(and(eq(publishBatches.id, batchId), eq(publishBatches.userId, userId), isNull(publishBatches.completedAt)))
      .returning({ id: publishBatches.id });
    if (!active) return false;
    const [target] = await tx.update(publishResults).set({ status: "sending", groupName: name }).where(and(
      eq(publishResults.userId, userId),
      eq(publishResults.batchId, batchId),
      eq(publishResults.groupUrl, url),
      eq(publishResults.status, "queued"),
    )).returning({ id: publishResults.id });
    return Boolean(target);
  });
}
