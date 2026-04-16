import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";

const VK_API_VERSION = "5.199";

/**
 * Uploads a video to a VK group wall.
 * Flow: video.save (with group_id) -> POST file to returned upload_url -> returns owner_id/video_id.
 * Executed on the server so the token's IP matches the API caller's IP.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const videoUrl: string = body.video_url;
  const groupId: number | string | undefined = body.group_id;
  const name: string = body.name || "Видео";

  if (!videoUrl || !groupId) {
    return NextResponse.json({ detail: "video_url and group_id required" }, { status: 400 });
  }

  try {
    // 1) Get upload URL for this group
    const saveForm = new URLSearchParams({
      access_token: auth.session.access_token,
      v: VK_API_VERSION,
      group_id: String(groupId),
      name: name.slice(0, 128),
      wallpost: "0",
    });
    const saveResp = await fetch("https://api.vk.com/method/video.save", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: saveForm.toString(),
    });
    const saveData = await saveResp.json();
    if (saveData.error) {
      return NextResponse.json({ detail: `video.save: ${saveData.error.error_msg}`, code: saveData.error.error_code }, { status: 400 });
    }
    const uploadUrl: string = saveData.response?.upload_url;
    const ownerId: number = saveData.response?.owner_id;
    const videoId: number = saveData.response?.video_id;
    if (!uploadUrl || !ownerId || !videoId) {
      return NextResponse.json({ detail: "Invalid video.save response" }, { status: 400 });
    }

    // 2) Stream video file from our Blob to the VK upload URL
    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      return NextResponse.json({ detail: `Не удалось загрузить видео из хранилища: ${videoResp.status}` }, { status: 400 });
    }
    const contentType = videoResp.headers.get("content-type") || "video/mp4";
    const extFromUrl = (videoUrl.split("?")[0].split(".").pop() || "mp4").toLowerCase();
    const fileName = `video.${/^[a-z0-9]{2,5}$/.test(extFromUrl) ? extFromUrl : "mp4"}`;
    const data = await videoResp.arrayBuffer();

    const fd = new FormData();
    fd.append("video_file", new Blob([data], { type: contentType }), fileName);

    const uploadResp = await fetch(uploadUrl, { method: "POST", body: fd });
    if (!uploadResp.ok) {
      const txt = await uploadResp.text().catch(() => "");
      return NextResponse.json({ detail: `Ошибка загрузки в VK: ${uploadResp.status} ${txt}`.slice(0, 300) }, { status: 400 });
    }

    return NextResponse.json({ attachment: `video${ownerId}_${videoId}`, owner_id: ownerId, video_id: videoId });
  } catch (e) {
    return NextResponse.json({ detail: `Upload failed: ${(e as Error).message}` }, { status: 500 });
  }
}
