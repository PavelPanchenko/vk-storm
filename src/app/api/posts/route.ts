import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { listPosts, createPost, getPost } from "@/lib/posts";
import { appendLog } from "@/lib/logger";

const SAFE_NAME_RE = /^[a-zA-Z0-9_\- а-яА-ЯёЁ.,!?()]+$/;

export async function GET() {
  const result = await requireSession();
  if (result.error) return result.error;
  return NextResponse.json(await listPosts(result.session.user_id));
}

export async function POST(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Ожидается JSON с name, text, images, videos" }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  const text = String(body.text || "").trim();
  const imageUrls = Array.isArray(body.images) ? (body.images as unknown[]).filter((u): u is string => typeof u === "string") : [];
  const videoUrls = Array.isArray(body.videos) ? (body.videos as unknown[]).filter((u): u is string => typeof u === "string") : [];

  if (!SAFE_NAME_RE.test(name)) {
    return NextResponse.json({ detail: "Недопустимое имя поста. Используйте буквы, цифры, _ и -" }, { status: 400 });
  }

  const existing = await getPost(result.session.user_id, name);
  if (existing) {
    return NextResponse.json({ detail: `Пост '${name}' уже существует` }, { status: 400 });
  }

  try {
    await createPost(result.session.user_id, name, text, imageUrls, videoUrls);
    await appendLog("INFO", `Post created: ${name}`);
    return NextResponse.json({ status: "ok", name });
  } catch (e) {
    console.error("Post creation error:", e);
    return NextResponse.json({ detail: String(e) }, { status: 500 });
  }
}
