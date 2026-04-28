import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { publishResults } from "@/lib/db/schema";
import { appendLog } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  const body = await request.json();
  const batchId: string = body.batchId || "";
  const postText: string = body.postText || "";
  const results: { postName: string; groupUrl: string; groupName?: string; success: boolean; error?: string }[] = body.results || [];

  if (!Array.isArray(results) || results.length === 0) {
    return NextResponse.json({ detail: "Результаты пусты" }, { status: 400 });
  }

  const rows = results.map((r) => ({
    sessionId: result.sessionId!,
    userId: result.session.user_id,
    batchId,
    postName: r.postName,
    postText,
    groupUrl: r.groupUrl,
    groupName: r.groupName || "",
    success: r.success,
    error: r.error || null,
  }));

  await db.insert(publishResults).values(rows);

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;
  await appendLog("INFO", `Publish completed: ${successCount} success, ${failedCount} failed`);

  return NextResponse.json({ saved: results.length });
}
