import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import sharp from "sharp";
import { readPrivateBlob } from "./blob-storage";
import { privateBlobPath } from "./media-upload-config";
import { resolveUploadPath } from "./storage";

const MAX_UPLOAD_BYTES = 2_500_000;
const MAX_SIDE_PX = 2560;

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function loadImageBlob(imageUrl: string, signal?: AbortSignal): Promise<{ blob: Blob; fileName: string }> {
  const pathname = privateBlobPath(imageUrl);
  if (pathname) {
    const result = await readPrivateBlob(pathname, undefined, signal);
    if (!result) throw new Error("Файл изображения не найден");
    const blob = await new Response(result.stream, {
      headers: { "Content-Type": result.blob.contentType },
    }).blob();
    return { blob, fileName: basename(pathname) };
  }
  if (imageUrl.startsWith("/uploads/")) {
    const rel = imageUrl.slice("/uploads/".length);
    const abs = resolveUploadPath(rel);
    if (!abs) throw new Error("Некорректный путь к изображению");
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) throw new Error("Файл изображения не найден");
    const ext = extname(abs).toLowerCase();
    const contentType = IMAGE_MIME[ext] || "image/jpeg";
    const data = await readFile(abs, { signal });
    return { blob: new Blob([data], { type: contentType }), fileName: basename(abs) || `photo${ext}` };
  }

  const imgResp = await fetch(imageUrl, { signal });
  if (!imgResp.ok) throw new Error(`Не удалось загрузить изображение: HTTP ${imgResp.status}`);
  const fileData = await imgResp.arrayBuffer();
  const contentType = imgResp.headers.get("content-type") || "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpg";
  return { blob: new Blob([fileData], { type: contentType }), fileName: `photo.${ext}` };
}

/** Уменьшает тяжёлые фото перед upload на VK — снижает риск HTTP 504. */
export async function optimizeImageForVkUpload(
  blob: Blob,
  fileName: string,
): Promise<{ blob: Blob; fileName: string }> {
  if (blob.type === "image/gif") return { blob, fileName };

  const buf = Buffer.from(await blob.arrayBuffer());
  try {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (buf.length <= MAX_UPLOAD_BYTES && w <= MAX_SIDE_PX && h <= MAX_SIDE_PX) {
      return { blob, fileName };
    }

    const out = await sharp(buf)
      .rotate()
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const base = fileName.replace(/\.[^.]+$/, "") || "photo";
    return { blob: new Blob([new Uint8Array(out)], { type: "image/jpeg" }), fileName: `${base}.jpg` };
  } catch {
    return { blob, fileName };
  }
}

export function parseVkPhotoUploadResult(uploadResult: Record<string, unknown>): {
  server: string;
  photo: string;
  hash: string;
} {
  const payload = uploadResult.photo;
  const photo = Array.isArray(payload) ? JSON.stringify(payload) : typeof payload === "string" ? payload : "";
  if (!photo.trim() || /^\[\s*\]$/.test(photo.trim())) {
    throw new Error("VK upload server вернул пустой photo");
  }
  const { server, hash } = uploadResult;
  const serverId = typeof server === "number" || typeof server === "string" ? String(server) : "";
  if (!/^\d+$/.test(serverId) || typeof hash !== "string" || !hash.trim()) {
    throw new Error("Неполный ответ VK upload server");
  }
  return { server: serverId, photo, hash };
}

export function photoAttachmentFromSaveResponse(saved: unknown): string | null {
  const items = Array.isArray(saved) ? saved : (saved as { items?: unknown } | null)?.items;
  const photo = Array.isArray(items) ? items[0] : null;
  if (!photo || typeof photo !== "object") return null;

  const { owner_id: ownerId, id, access_key: accessKey } = photo as Record<string, unknown>;
  const owner = typeof ownerId === "number" || typeof ownerId === "string" ? String(ownerId) : "";
  const photoId = typeof id === "number" || typeof id === "string" ? String(id) : "";
  if (!/^-?[1-9]\d*$/.test(owner) || !/^[1-9]\d*$/.test(photoId)) return null;

  const key = typeof accessKey === "string" ? accessKey.trim() : "";
  return `photo${owner}_${photoId}${key ? `_${key}` : ""}`;
}
