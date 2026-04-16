import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
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

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { path: segments } = await params;
  if (!segments || segments.length === 0) {
    return new NextResponse("Not Found", { status: 404 });
  }

  for (const seg of segments) {
    if (!seg || seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\") || seg.includes("\0")) {
      return new NextResponse("Not Found", { status: 404 });
    }
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
  const contentType = MIME[ext] || "application/octet-stream";
  const nodeStream = createReadStream(abs);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
