import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";

/**
 * Proxy for uploading photos to VK upload server.
 * VK upload servers don't support CORS, so we relay the multipart POST here.
 * No VK token needed — just forwards the file to the upload_url.
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
    // Fetch the image from our storage (Vercel Blob, etc.)
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      return NextResponse.json({ detail: `Failed to fetch image: ${imgResp.status}` }, { status: 400 });
    }
    const fileData = await imgResp.arrayBuffer();
    const contentType = imgResp.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";

    // Build multipart form and POST to VK upload server
    const formData = new FormData();
    formData.append("photo", new Blob([fileData], { type: contentType }), `photo.${ext}`);

    const uploadResp = await fetch(uploadUrl, { method: "POST", body: formData });
    const uploadResult = await uploadResp.json();

    return NextResponse.json(uploadResult);
  } catch (e) {
    return NextResponse.json({ detail: `Upload failed: ${e}` }, { status: 500 });
  }
}
