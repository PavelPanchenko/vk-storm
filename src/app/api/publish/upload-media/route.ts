import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { uploadPublishVideos } from "@/lib/vk-media-upload";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const videos = Array.isArray(body.videos) ? body.videos.filter((u: unknown) => typeof u === "string") : [];
  const name = typeof body.name === "string" ? body.name : "Видео";

  if (videos.length === 0) {
    return NextResponse.json({ attachments: [], errors: [] });
  }

  const { attachments, errors } = await uploadPublishVideos(
    auth.sessionId,
    auth.session,
    videos,
    name,
  );

  return NextResponse.json({ attachments, errors });
}
