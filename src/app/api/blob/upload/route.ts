import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { saveUpload } from "@/lib/storage";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/mpeg", "video/x-msvideo"];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const form = await request.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") || "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Поле 'file' обязательно" }, { status: 400 });
  }
  if (kind !== "image" && kind !== "video") {
    return NextResponse.json({ error: "Поле 'kind' должно быть 'image' или 'video'" }, { status: 400 });
  }

  const allowed = kind === "video" ? VIDEO_TYPES : IMAGE_TYPES;
  const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: `Неподдерживаемый тип файла: ${file.type || "unknown"}` }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return NextResponse.json(
      { error: `Файл слишком большой. Лимит: ${kind === "video" ? "500 MB" : "20 MB"}` },
      { status: 413 },
    );
  }

  try {
    const { url } = await saveUpload(file.stream(), file.name || `${kind}.bin`, kind === "video" ? "videos" : "images");
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: `Ошибка сохранения: ${(e as Error).message}` }, { status: 500 });
  }
}
