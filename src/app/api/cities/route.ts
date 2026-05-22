import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { searchCities } from "@/lib/vk-discovery";

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const query = request.nextUrl.searchParams.get("q") || "";
  if (!query.trim()) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await searchCities(auth.sessionId, auth.session, query.trim());
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
