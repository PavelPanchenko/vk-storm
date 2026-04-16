import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { requireSession } from "@/lib/api-auth";
import { getPost, updatePost } from "@/lib/posts";

type Params = { params: Promise<{ name: string; filename: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const result = await requireSession();
  if (result.error) return result.error;
  const { name, filename } = await params;
  const post = await getPost(name);
  if (!post) {
    return NextResponse.json({ detail: "Пост не найден" }, { status: 404 });
  }
  // Find matching blob URL by filename
  const blobUrl = post.images.find((url) => url.includes(encodeURIComponent(filename)) || url.includes(filename));
  if (!blobUrl) {
    return NextResponse.json({ detail: "Изображение не найдено" }, { status: 404 });
  }
  // Redirect to Blob URL
  return NextResponse.redirect(blobUrl);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const result = await requireSession();
  if (result.error) return result.error;
  const { name, filename } = await params;
  const post = await getPost(name);
  if (!post) {
    return NextResponse.json({ detail: "Пост не найден" }, { status: 404 });
  }
  const blobUrl = post.images.find((url) => url.includes(encodeURIComponent(filename)) || url.includes(filename));
  if (!blobUrl) {
    return NextResponse.json({ detail: "Изображение не найдено" }, { status: 404 });
  }
  try { await del(blobUrl); } catch {}
  const remaining = post.images.filter((url) => url !== blobUrl);
  await updatePost(name, post.text, remaining, post.videos);
  return NextResponse.json({ status: "ok" });
}
