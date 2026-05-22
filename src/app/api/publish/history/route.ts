import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { publishResults } from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const userId = auth.session.user_id;

  const summary = await db
    .select({
      batchId: publishResults.batchId,
      postName: publishResults.postName,
      postText: publishResults.postText,
      createdAt: sql<string>`min(${publishResults.createdAt})`.as("created_at"),
      totalGroups: sql<number>`count(*)`.as("total_groups"),
      successCount: sql<number>`count(*) filter (where ${publishResults.success} = true)`.as("success_count"),
      failedCount: sql<number>`count(*) filter (where ${publishResults.success} = false)`.as("failed_count"),
    })
    .from(publishResults)
    .where(eq(publishResults.userId, userId))
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

  const batches = summary
    .filter((s) => s.batchId)
    .map((s) => ({
      batchId: s.batchId,
      postName: s.postName,
      postText: s.postText,
      createdAt: s.createdAt,
      totalGroups: Number(s.totalGroups),
      successCount: Number(s.successCount),
      failedCount: Number(s.failedCount),
      groups: (grouped.get(s.batchId) ?? []).map((d) => ({
        groupUrl: d.groupUrl,
        groupName: d.groupName,
        success: d.success,
        error: d.error,
        createdAt: d.createdAt,
      })),
    }));

  return NextResponse.json(batches);
}
