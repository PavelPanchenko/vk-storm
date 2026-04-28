import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { blacklist } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET() {
  const result = await requireSession();
  if (result.error) return result.error;

  const rows = await db.select().from(blacklist).where(eq(blacklist.userId, result.session.user_id)).orderBy(blacklist.createdAt);
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  const body = await request.json();
  const urls: string[] = body.urls || [];
  const reason: string = body.reason || "";

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ detail: "urls required" }, { status: 400 });
  }

  let added = 0;
  for (const url of urls) {
    try {
      await db.insert(blacklist).values({ userId: result.session.user_id, url, reason }).onConflictDoNothing();
      added++;
    } catch {}
  }

  return NextResponse.json({ added });
}

export async function DELETE(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  const body = await request.json();
  const urls: string[] = body.urls || [];

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ detail: "urls required" }, { status: 400 });
  }

  for (const url of urls) {
    await db.delete(blacklist).where(and(eq(blacklist.userId, result.session.user_id), eq(blacklist.url, url)));
  }

  return NextResponse.json({ removed: urls.length });
}
