import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getPost, updatePost, deletePost } from "@/lib/posts";
import { deleteUnusedAttachments, ownsNewAttachments } from "@/lib/media-access";
import { appendLog } from "@/lib/logger";

type Params = { params: Promise<{ name: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const result = await requireSession();
  if (result.error) return result.error;
  const { name } = await params;
  const post = await getPost(result.session.user_id, name);
  if (!post) {
    return NextResponse.json({ detail: "Пост не найден" }, { status: 404 });
  }
  return NextResponse.json(post);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const result = await requireSession();
  if (result.error) return result.error;
  const { name } = await params;
  const post = await getPost(result.session.user_id, name);
  if (!post) {
    return NextResponse.json({ detail: "Пост не найден" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Ожидается JSON с text, images, videos" }, { status: 400 });
  }

  const text = String(body.text || "").trim();
  const imageUrls = Array.isArray(body.images) ? (body.images as unknown[]).filter((u): u is string => typeof u === "string") : [];
  const videoUrls = Array.isArray(body.videos) ? (body.videos as unknown[]).filter((u): u is string => typeof u === "string") : [];

  const oldUrls = [...post.images, ...post.videos];
  const newUrls = [...imageUrls, ...videoUrls];
  if (!await ownsNewAttachments(result.session.user_id, newUrls.filter(url => !oldUrls.includes(url)))) {
    return NextResponse.json({ detail: "Вложения недоступны" }, { status: 400 });
  }

  await updatePost(result.session.user_id, name, text, imageUrls, videoUrls);
  await deleteUnusedAttachments(result.session.user_id, oldUrls.filter(url => !newUrls.includes(url)));
  return NextResponse.json({ status: "ok", name });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const result = await requireSession();
  if (result.error) return result.error;
  const { name } = await params;
  const post = await getPost(result.session.user_id, name);
  if (!post) {
    return NextResponse.json({ detail: "Пост не найден" }, { status: 404 });
  }

  await deletePost(result.session.user_id, name);
  await deleteUnusedAttachments(result.session.user_id, [...post.images, ...post.videos]);
  await appendLog("INFO", `Post deleted: ${name}`, result.session.user_id);
  return NextResponse.json({ status: "ok" });
}
