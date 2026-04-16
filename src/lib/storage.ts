import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const UPLOADS_DIR = resolve(process.env.UPLOADS_DIR || "./uploads");

function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 120) || "file";
}

function todayFolder(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function saveUpload(
  stream: ReadableStream<Uint8Array> | Buffer,
  originalName: string,
  subdir: string,
): Promise<{ url: string; path: string }> {
  const safeSubdir = subdir.replace(/[^a-zA-Z0-9_-]/g, "") || "misc";
  const day = todayFolder();
  const filename = `${randomBytes(8).toString("hex")}-${sanitizeName(originalName)}`;
  const dir = join(UPLOADS_DIR, safeSubdir, day);
  await mkdir(dir, { recursive: true });
  const absPath = join(dir, filename);

  if (Buffer.isBuffer(stream)) {
    const ws = createWriteStream(absPath);
    await pipeline(Readable.from(stream), ws);
  } else {
    const nodeStream = Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0]);
    const ws = createWriteStream(absPath);
    await pipeline(nodeStream, ws);
  }

  return {
    url: `/uploads/${safeSubdir}/${day}/${filename}`,
    path: absPath,
  };
}

export async function deleteUpload(url: string): Promise<void> {
  if (!url || !url.startsWith("/uploads/")) return;
  const rel = url.slice("/uploads/".length);
  const absPath = resolve(UPLOADS_DIR, rel);
  const root = UPLOADS_DIR.endsWith(sep) ? UPLOADS_DIR : UPLOADS_DIR + sep;
  if (!absPath.startsWith(root)) return;
  try {
    await unlink(absPath);
  } catch {
    // silently ignore missing files
  }
}

export function resolveUploadPath(relative: string): string | null {
  const absPath = resolve(UPLOADS_DIR, relative);
  const root = UPLOADS_DIR.endsWith(sep) ? UPLOADS_DIR : UPLOADS_DIR + sep;
  if (absPath !== UPLOADS_DIR && !absPath.startsWith(root)) return null;
  return absPath;
}

export { dirname };
