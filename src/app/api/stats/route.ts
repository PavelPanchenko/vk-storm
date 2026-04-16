import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readGroups } from "@/lib/groups";
import { readLogs } from "@/lib/logger";
import { db } from "@/lib/db";
import { posts, publishResults } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  const result = await requireSession();
  if (result.error) return result.error;

  const [postCount] = await db.select({ count: sql<number>`count(*)` }).from(posts);
  const totalPosts = Number(postCount?.count || 0);

  const groups = await readGroups();
  const totalGroups = groups.length;

  // Count from publishResults table
  const [counts] = await db
    .select({
      totalPublished: sql<number>`count(*) filter (where ${publishResults.success} = true)`,
      totalErrors: sql<number>`count(*) filter (where ${publishResults.success} = false)`,
    })
    .from(publishResults);

  const totalPublished = Number(counts?.totalPublished || 0);
  const totalErrors = Number(counts?.totalErrors || 0);

  // Recent activity from logs
  const lines = await readLogs();
  const recentActivity: { level: string; message: string; time: string }[] = [];

  for (const line of lines.slice(-10)) {
    let level = "info";
    if (line.includes("ERROR")) level = "error";
    else if (line.includes("Published") || line.includes("Успешно") || line.includes("success")) level = "success";
    else if (line.includes("WARNING")) level = "warning";

    const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    const msg = line.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},?\d* - \w+ - /, "");
    recentActivity.push({ level, message: msg, time: timeMatch?.[1] || "" });
  }
  recentActivity.reverse();

  return NextResponse.json({
    total_posts: totalPosts,
    total_groups: totalGroups,
    total_published: totalPublished,
    total_errors: totalErrors,
    recent_activity: recentActivity,
  });
}
