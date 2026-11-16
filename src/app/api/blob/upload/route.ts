import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { mediaUploads } from "@/lib/db/schema";
import { deleteUpload, saveUpload } from "@/lib/storage";

import { privateBlobToken } from "@/lib/blob-storage";
import { isMediaKind, mediaUploadConfig, privateBlobPath } from "@/lib/media-upload-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePrivateUpload(request: NextRequest, token: string) {
  const body = await request.json().catch(() => null) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Некорректный запрос загрузки" }, { status: 400 });
  try {
    const result = await handleUpload({
      token,
      body,
      request,
      onBeforeGenerateToken: async (pathname, kind) => {
        const auth = await requireSession();
        if (auth.error) throw new Error("Не авторизован");
        const url = `/uploads/${pathname}`;
        if (!isMediaKind(kind) || !privateBlobPath(url)) throw new Error("Некорректный путь вложения");
        const { extensions, maxBytes } = mediaUploadConfig[kind];
        const allowedContentTypes = Object.entries(extensions)
          .filter(([, extension]) => pathname.endsWith(`.${extension}`)).map(([type]) => type);
        if (!allowedContentTypes.length) throw new Error("Неподдерживаемый формат вложения");

        const [reserved] = await db.insert(mediaUploads).values({ url, userId: auth.session.user_id })
          .onConflictDoNothing().returning({ url: mediaUploads.url });
        if (!reserved) throw new Error("Путь вложения уже занят");
        return { allowedContentTypes, maximumSizeInBytes: maxBytes };
      },
      // The path belongs to the authenticated uploader before bytes are sent.
      // The post is created only after the browser receives a successful upload.
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = privateBlobToken();
  if (request.headers.get("content-type")?.includes("application/json")) {
    if (!token) return NextResponse.json({ error: "Blob-хранилище не подключено" }, { status: 503 });
    return handlePrivateUpload(request, token);
  }
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (process.env.VERCEL === "1" || token) {
    return NextResponse.json({ error: "Обновите страницу для прямой загрузки вложений" }, { status: 415 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") || "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Поле 'file' обязательно" }, { status: 400 });
  }
  if (!isMediaKind(kind)) {
    return NextResponse.json({ error: "Поле 'kind' должно быть 'image' или 'video'" }, { status: 400 });
  }

  const { extensions, maxBytes } = mediaUploadConfig[kind];

  if (!Object.hasOwn(extensions, file.type)) {
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
    try {
      await db.insert(mediaUploads).values({ url, userId: auth.session.user_id });
    } catch (error) {
      await deleteUpload(url);
      throw error;
    }
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: `Ошибка сохранения: ${(e as Error).message}` }, { status: 500 });
  }
}
