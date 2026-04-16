import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readLogs, clearLogs, cleanupOldLogs } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  // Auto-cleanup logs older than 7 days on each read
  await cleanupOldLogs(7);

  const level = new URL(request.url).searchParams.get("level") || undefined;
  const lines = await readLogs(level);
  return NextResponse.json({ lines });
}

export async function DELETE() {
  const result = await requireSession();
  if (result.error) return result.error;
  await clearLogs();
  return NextResponse.json({ ok: true });
}
