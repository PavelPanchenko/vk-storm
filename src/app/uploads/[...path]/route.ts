import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { readPrivateBlob } from "@/lib/blob-storage";
import { privateBlobPath } from "@/lib/media-upload-config";
import { requireSession } from "@/lib/api-auth";
import { canReadAttachment } from "@/lib/media-access";
import { resolveUploadPath } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".avi": "video/x-msvideo",
};

type Params = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { path: segments } = await params;
  if (!segments || segments.length === 0) {
    return new NextResponse("Not Found", { status: 404 });
  }

  for (const seg of segments) {
    if (!seg || seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\") || seg.includes("\0")) {
      return new NextResponse("Not Found", { status: 404 });
    }
  }

  const auth = await requireSession();
  if (auth.error) return auth.error;
  const url = `/uploads/${segments.join("/")}`;
  if (!await canReadAttachment(auth.session.user_id, url)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const pathname = privateBlobPath(url);
  if (pathname) {
    const requestRange = request.headers.get("range");
    if (requestRange && !/^bytes=(?:\d+-\d*|-\d+)$/.test(requestRange)) return new Response(null, { status: 416 });
    const blob = await readPrivateBlob(pathname, requestRange ?? undefined, request.signal).catch(error => {
      if (error instanceof Error && error.message.startsWith("Vercel Blob: Failed to fetch blob: 416")) return "invalid-range" as const;
      throw error;
    });
    if (blob === "invalid-range") return new Response(null, { status: 416 });
    if (!blob) return new NextResponse("Not Found", { status: 404 });
    const headers = privateHeaders(MIME[extname(pathname)] || "application/octet-stream");
    for (const key of ["content-length", "content-range"]) {
      const value = blob.headers.get(key);
      if (value) headers.set(key, value);
    }
    return new Response(blob.stream, { status: headers.has("content-range") ? 206 : 200, headers });
  }

  const abs = resolveUploadPath(join(...segments));
  if (!abs) return new NextResponse("Not Found", { status: 404 });

  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return new NextResponse("Not Found", { status: 404 });
    size = st.size;
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }

  const ext = extname(abs).toLowerCase();
  const headers = privateHeaders(MIME[ext] || "application/octet-stream");
  headers.set("Content-Length", String(size));

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? byteRange(rangeHeader, size) : null;
  if (rangeHeader && !range) {
    headers.set("Content-Range", `bytes */${size}`);
    headers.delete("Content-Length");
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    headers.set("Content-Length", String(range.end - range.start + 1));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  }
  const nodeStream = createReadStream(abs, range ?? undefined);
  const stream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, { status: range ? 206 : 200, headers });
}

function privateHeaders(contentType: string) {
  return new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
}

function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || size === 0) return null;
  const [, first, last] = match;
  if (!first && !last) return null;
  const start = first ? Number(first) : Math.max(0, size - Number(last));
  const end = first && last ? Math.min(size - 1, Number(last)) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end ? { start, end } : null;
}
