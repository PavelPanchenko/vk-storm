import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { uploadWallVideoForPublish } from "@/lib/vk-media-upload";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const videoUrl: string = body.video_url;
  const name: string = body.name || "Видео";

  if (!videoUrl) {
    return NextResponse.json({ detail: "video_url required" }, { status: 400 });
  }

  try {
    const { attachment } = await uploadWallVideoForPublish(auth.sessionId, auth.session, videoUrl, name);
    const m = attachment.match(/^video(-?\d+)_(\d+)$/);
    return NextResponse.json({
      attachment,
      owner_id: m ? Number(m[1]) : undefined,
      video_id: m ? Number(m[2]) : undefined,
    });
  } catch (e) {
    return NextResponse.json({ detail: `Upload failed: ${(e as Error).message}` }, { status: 500 });
  }
}
