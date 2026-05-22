import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { loadImageBlob, parseVkPhotoUploadResult } from "@/lib/vk-image-blob";

export const runtime = "nodejs";

/**
 * Proxy for uploading photos to VK upload server.
 * VK upload servers don't support CORS, so we relay the multipart POST here.
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
    const { blob, fileName } = await loadImageBlob(imageUrl);
    const formData = new FormData();
    formData.append("photo", blob, fileName);

    const uploadResp = await fetch(uploadUrl, { method: "POST", body: formData });
    const uploadResult = (await uploadResp.json().catch(() => ({}))) as Record<string, unknown>;

    if (!uploadResp.ok) {
      return NextResponse.json(
        { detail: `Ошибка загрузки в VK: HTTP ${uploadResp.status}` },
        { status: 400 },
      );
    }

    try {
      parseVkPhotoUploadResult(uploadResult);
    } catch (e) {
      return NextResponse.json({ detail: (e as Error).message }, { status: 400 });
    }

    return NextResponse.json(uploadResult);
  } catch (e) {
    return NextResponse.json({ detail: `Upload failed: ${(e as Error).message}` }, { status: 500 });
  }
}
