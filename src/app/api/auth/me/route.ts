import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";

export async function GET() {
  const result = await requireSession();
  if (result.error) return result.error;
  const s = result.session!;
  return NextResponse.json({ user_id: s.user_id, name: s.user_name, avatar: s.user_photo, access_token: s.access_token });
}
