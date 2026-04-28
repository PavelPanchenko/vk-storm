import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getPost, updatePost, deletePost } from "@/lib/posts";
import { deleteUpload } from "@/lib/storage";
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

  const removedImages = post.images.filter((url) => !imageUrls.includes(url));
  const removedVideos = (post.videos || []).filter((url) => !videoUrls.includes(url));
  for (const url of [...removedImages, ...removedVideos]) {
    try { await deleteUpload(url); } catch {}
  }

  await updatePost(result.session.user_id, name, text, imageUrls, videoUrls);
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

  for (const url of [...post.images, ...(post.videos || [])]) {
    try { await deleteUpload(url); } catch {}
  }

  await deletePost(result.session.user_id, name);
  await appendLog("INFO", `Post deleted: ${name}`);
  return NextResponse.json({ status: "ok" });
}
