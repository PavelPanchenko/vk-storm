import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { publishBatches, publishResults } from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { closePublishBatches } from "@/lib/publish-batches";
import { isRetryable, type HistoryBatch, type PublishStatus } from "@/lib/publish-status";

export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const userId = auth.session.user_id;
  await closePublishBatches(userId);

  const summary = await db
    .select({
      batchId: publishResults.batchId,
      postName: publishResults.postName,
      postText: publishResults.postText,
      createdAt: sql<string>`min(${publishResults.createdAt})`.mapWith(publishResults.createdAt).as("created_at"),
      totalGroups: sql<number>`count(*)`.as("total_groups"),
      successCount: sql<number>`count(*) filter (where ${publishResults.success} = true)`.as("success_count"),
      failedCount: sql<number>`count(*) filter (where ${publishResults.status} = 'failed' or (${publishResults.status} is null and ${publishResults.success} = false))`.as("failed_count"),
    })
    .from(publishResults)
    .where(and(eq(publishResults.userId, userId), sql`${publishResults.batchId} <> ''`))
    .groupBy(publishResults.batchId, publishResults.postName, publishResults.postText)
    .orderBy(desc(sql`min(${publishResults.createdAt})`))
    .limit(50);

  const batchIds = summary.map((s) => s.batchId).filter((id): id is string => Boolean(id));
  if (batchIds.length === 0) return NextResponse.json([]);

  const details = await db
    .select({
      batchId: publishResults.batchId,
      groupUrl: publishResults.groupUrl,
      groupName: publishResults.groupName,
      success: publishResults.success,
      status: publishResults.status,
      postUrl: publishResults.postUrl,
      error: publishResults.error,
      createdAt: publishResults.createdAt,
    })
    .from(publishResults)
    .where(and(eq(publishResults.userId, userId), inArray(publishResults.batchId, batchIds)))
    .orderBy(publishResults.createdAt);

  const grouped = new Map<string, typeof details>();
  for (const d of details) {
    if (!d.batchId) continue;
    const arr = grouped.get(d.batchId) ?? [];
    arr.push(d);
    grouped.set(d.batchId, arr);
  }

  const retries = await db.select({ retryOf: publishBatches.retryOf }).from(publishBatches)
    .where(and(eq(publishBatches.userId, userId), inArray(publishBatches.retryOf, batchIds)));
  const retried = new Set(retries.map(({ retryOf }) => retryOf));

  const batches: HistoryBatch[] = summary.map((batch) => {
    const rows = grouped.get(batch.batchId) ?? [];
    const groups = rows.map((row) => ({
      groupUrl: row.groupUrl,
      groupName: row.groupName,
      status: (row.status ?? (row.success ? "sent" : "failed")) as PublishStatus,
      postUrl: row.postUrl,
      error: row.error,
    }));
    return {
      batchId: batch.batchId,
      postName: batch.postName,
      postText: batch.postText,
      createdAt: batch.createdAt.toISOString(),
      totalGroups: Number(batch.totalGroups),
      successCount: Number(batch.successCount),
      failedCount: Number(batch.failedCount),
      canRetry: !retried.has(batch.batchId)
        && rows.some((row) => row.status && isRetryable(row.status as PublishStatus))
        && !groups.some(({ status }) => status === "queued" || status === "sending"),
      groups,
    };
  });

  return NextResponse.json(batches);
}
