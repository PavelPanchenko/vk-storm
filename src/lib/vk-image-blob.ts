import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { resolveUploadPath } from "./storage";

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
