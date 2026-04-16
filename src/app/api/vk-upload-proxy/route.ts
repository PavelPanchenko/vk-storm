import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { requireSession } from "@/lib/api-auth";
import { resolveUploadPath } from "@/lib/storage";

export const runtime = "nodejs";

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Proxy for uploading photos to VK upload server.
 * VK upload servers don't support CORS, so we relay the multipart POST here.
 * Reads local /uploads/ paths off disk; otherwise fetches the URL.
 */
export async function POST(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  const body = await request.json();
  const uploadUrl: string = body.upload_url;
  const imageUrl: string = body.image_url;

  if (!uploadUrl || !imageUrl) {
    return NextResponse.json({ detail: "upload_url and image_url required" }, { status: 400 });
  }

  try {
    let fileBlob: Blob;
    let fileName: string;

    if (imageUrl.startsWith("/uploads/")) {
      const rel = imageUrl.slice("/uploads/".length);
      const abs = resolveUploadPath(rel);
      if (!abs) return NextResponse.json({ detail: "Invalid image path" }, { status: 400 });
      const st = await stat(abs).catch(() => null);
      if (!st || !st.isFile()) return NextResponse.json({ detail: "Image not found" }, { status: 404 });
      const ext = extname(abs).toLowerCase();
      const contentType = IMAGE_MIME[ext] || "image/jpeg";
      const data = await readFile(abs);
      fileBlob = new Blob([data], { type: contentType });
      fileName = basename(abs) || `photo${ext}`;
    } else {
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) {
        return NextResponse.json({ detail: `Failed to fetch image: ${imgResp.status}` }, { status: 400 });
      }
      const fileData = await imgResp.arrayBuffer();
      const contentType = imgResp.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : "jpg";
      fileBlob = new Blob([fileData], { type: contentType });
      fileName = `photo.${ext}`;
    }

    const formData = new FormData();
    formData.append("photo", fileBlob, fileName);

    const uploadResp = await fetch(uploadUrl, { method: "POST", body: formData });
    const uploadResult = await uploadResp.json();

    return NextResponse.json(uploadResult);
  } catch (e) {
    return NextResponse.json({ detail: `Upload failed: ${e}` }, { status: 500 });
  }
}

