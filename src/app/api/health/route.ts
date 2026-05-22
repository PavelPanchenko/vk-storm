import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch (e) {
    return NextResponse.json(
      { status: "degraded", db: "error", message: (e as Error).message },
      { status: 503 },
    );
  }
}
