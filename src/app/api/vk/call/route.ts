import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";

const VK_API_VERSION = "5.199";
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

  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    form.append(k, String(v));
  }
  form.set("access_token", result.session.access_token);
  form.set("v", VK_API_VERSION);

  const resp = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await resp.json();

  return NextResponse.json(data);
}
