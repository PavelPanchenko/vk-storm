import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { publishResults } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";

export async function GET() {
  const result = await requireSession();
  if (result.error) return result.error;

  const rows = await db
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
    .groupBy(publishResults.batchId, publishResults.postName, publishResults.postText)
    .orderBy(desc(sql`min(${publishResults.createdAt})`))
    .limit(50);

  // For each batch, get individual group results
  const batches = [];
  for (const row of rows) {
    if (!row.batchId) continue;
    const details = await db
      .select({
        groupUrl: publishResults.groupUrl,
        groupName: publishResults.groupName,
        success: publishResults.success,
        error: publishResults.error,
        createdAt: publishResults.createdAt,
      })
      .from(publishResults)
      .where(sql`${publishResults.batchId} = ${row.batchId}`)
      .orderBy(publishResults.createdAt);

    batches.push({
      batchId: row.batchId,
      postName: row.postName,
      postText: row.postText,
      createdAt: row.createdAt,
      totalGroups: Number(row.totalGroups),
      successCount: Number(row.successCount),
      failedCount: Number(row.failedCount),
      groups: details.map((d) => ({
        groupUrl: d.groupUrl,
        groupName: d.groupName,
        success: d.success,
        error: d.error,
        createdAt: d.createdAt,
      })),
    });
  }

  return NextResponse.json(batches);
}
