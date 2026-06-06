import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import sharp from "sharp";
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

export async function loadImageBlob(imageUrl: string): Promise<{ blob: Blob; fileName: string }> {
  if (imageUrl.startsWith("/uploads/")) {
    const rel = imageUrl.slice("/uploads/".length);
    const abs = resolveUploadPath(rel);
    if (!abs) throw new Error("Некорректный путь к изображению");
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) throw new Error("Файл изображения не найден");
    const ext = extname(abs).toLowerCase();
    const contentType = IMAGE_MIME[ext] || "image/jpeg";
    const data = await readFile(abs);
    return { blob: new Blob([data], { type: contentType }), fileName: basename(abs) || `photo${ext}` };
  }

  const imgResp = await fetch(imageUrl);
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
    return { blob: new Blob([out], { type: "image/jpeg" }), fileName: `${base}.jpg` };
  } catch {
    return { blob, fileName };
  }
}

export function parseVkPhotoUploadResult(uploadResult: Record<string, unknown>): {
  server: string;
  photo: string;
  hash: string;
} {
  const photo = uploadResult.photo;
  if (!photo || photo === "[]") {
    throw new Error("VK upload server вернул пустой photo");
  }
  const server = uploadResult.server;
  const hash = uploadResult.hash;
  if (server == null || hash == null) {
    throw new Error("Неполный ответ VK upload server");
  }
  return { server: String(server), photo: String(photo), hash: String(hash) };
}

export function photoAttachmentFromSaveResponse(saved: unknown): string | null {
  const savedArr = Array.isArray(saved)
    ? saved
    : ((saved as Record<string, unknown>)?.items as unknown[] | undefined) || [];
  if (savedArr.length === 0) return null;
  const photo = savedArr[0] as Record<string, unknown>;
  if (photo.owner_id == null || photo.id == null) return null;
  return `photo${photo.owner_id}_${photo.id}`;
}
