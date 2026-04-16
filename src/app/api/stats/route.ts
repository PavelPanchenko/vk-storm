import { NextResponse } from "next/server";
import fs from "fs";
import { POSTS_DIR } from "@/lib/config";
import { requireSession } from "@/lib/api-auth";
import { readGroups } from "@/lib/groups";
import { readLogs } from "@/lib/logger";
import { db } from "@/lib/db";
import { publishResults } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const result = await requireSession();
  if (result.error) return result.error;

  let totalPosts = 0;
  try {
    if (fs.existsSync(POSTS_DIR)) {
      totalPosts = fs.readdirSync(POSTS_DIR).filter(d => fs.statSync(`${POSTS_DIR}/${d}`).isDirectory()).length;
    }
  } catch {}

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
