import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSession } from "@/lib/sessions";

export async function POST() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session_id")?.value;
  if (sessionId) await deleteSession(sessionId);
  const resp = NextResponse.json({ status: "ok" });
  resp.cookies.delete("session_id");
  return resp;
}
