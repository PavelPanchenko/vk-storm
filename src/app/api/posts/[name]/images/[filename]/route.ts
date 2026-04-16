import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getPost, updatePost } from "@/lib/posts";
import { deleteUpload } from "@/lib/storage";

type Params = { params: Promise<{ name: string; filename: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const result = await requireSession();
  if (result.error) return result.error;
  const { name, filename } = await params;
  const post = await getPost(name);
  if (!post) {
    return NextResponse.json({ detail: "Пост не найден" }, { status: 404 });
  }
  const storedUrl = post.images.find((url) => url.includes(encodeURIComponent(filename)) || url.includes(filename));
  if (!storedUrl) {
    return NextResponse.json({ detail: "Изображение не найдено" }, { status: 404 });
  }
  return NextResponse.redirect(new URL(storedUrl, _request.url));
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const result = await requireSession();
  if (result.error) return result.error;
  const { name, filename } = await params;
  const post = await getPost(name);
  if (!post) {
    return NextResponse.json({ detail: "Пост не найден" }, { status: 404 });
  }
  const storedUrl = post.images.find((url) => url.includes(encodeURIComponent(filename)) || url.includes(filename));
  if (!storedUrl) {
    return NextResponse.json({ detail: "Изображение не найдено" }, { status: 404 });
  }
  try { await deleteUpload(storedUrl); } catch {}
  const remaining = post.images.filter((url) => url !== storedUrl);
  await updatePost(name, post.text, remaining, post.videos);
  return NextResponse.json({ status: "ok" });
}
