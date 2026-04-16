import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { publishResults } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  const postName = new URL(request.url).searchParams.get("postName");
  if (!postName) return NextResponse.json({ detail: "Укажите postName" }, { status: 400 });

  const rows = await db
    .selectDistinct({ groupUrl: publishResults.groupUrl })
    .from(publishResults)
    .where(and(eq(publishResults.postName, postName), eq(publishResults.success, true)));

  return NextResponse.json(rows.map(r => r.groupUrl));
}
