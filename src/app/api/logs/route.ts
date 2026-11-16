import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readLogs, clearLogs, cleanupOldLogs } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  // Auto-cleanup logs older than 7 days on each read
  await cleanupOldLogs(result.session.user_id);

  const level = new URL(request.url).searchParams.get("level") || undefined;
  const rows = await readLogs(result.session.user_id, level);
  const lines = rows.reverse().map(({ createdAt, level, message }) =>
    `${createdAt.toISOString().slice(0, 19).replace("T", " ")} - ${level} - ${message}`);
  return NextResponse.json({ lines });
}

export async function DELETE() {
  const result = await requireSession();
  if (result.error) return result.error;
  await clearLogs(result.session.user_id);
  return NextResponse.json({ ok: true });
}
