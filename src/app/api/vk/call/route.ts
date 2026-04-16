import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { vkMethod } from "@/lib/vk-method";

const METHOD_RE = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/;

export async function POST(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  const body = await request.json().catch(() => ({}));
  const method = typeof body.method === "string" ? body.method : "";
  const params = (body.params && typeof body.params === "object") ? body.params as Record<string, string | number> : {};

  if (!METHOD_RE.test(method)) {
    return NextResponse.json({ detail: "Invalid method" }, { status: 400 });
  }

  const { data } = await vkMethod(result.sessionId, result.session, method, params);
  return NextResponse.json(data);
}
