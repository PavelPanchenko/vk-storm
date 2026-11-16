import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readGroups } from "@/lib/groups";
import { readLogs } from "@/lib/logger";
import { db } from "@/lib/db";
import { posts, publishResults } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const result = await requireSession();
  if (result.error) return result.error;

  const [postCount] = await db.select({ count: sql<number>`count(*)` }).from(posts).where(eq(posts.userId, result.session.user_id));
  const totalPosts = Number(postCount?.count || 0);

  const groups = await readGroups(result.session.user_id);
  const totalGroups = groups.length;

  // Count from publishResults table
  const [counts] = await db
    .select({
      totalPublished: sql<number>`count(*) filter (where ${publishResults.success} = true)`,
      totalErrors: sql<number>`count(*) filter (where ${publishResults.status} = 'failed' or (${publishResults.status} is null and ${publishResults.success} = false))`,
    })
    .from(publishResults)
    .where(eq(publishResults.userId, result.session.user_id));

  const totalPublished = Number(counts?.totalPublished || 0);
  const totalErrors = Number(counts?.totalErrors || 0);

  const recentActivity = (await readLogs(result.session.user_id, undefined, 10)).map((row) => ({
    level: row.level.toLowerCase(),
    message: row.message,
    time: row.createdAt.toISOString(),
  }));

  return NextResponse.json({
    total_posts: totalPosts,
    total_groups: totalGroups,
    total_published: totalPublished,
    total_errors: totalErrors,
    recent_activity: recentActivity,
  });
}
