import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { vkMethod } from "@/lib/vk-method";

/**
 * Uploads a video to VK.
 * Flow: video.save (optionally with group_id) -> streaming POST file to returned upload_url -> returns owner_id/video_id.
 * Executed on the server so the token's IP matches the API caller's IP.
 * Auto-refreshes token on Error 5 (IP-binding) via vkMethod().
 * Uses manual streaming multipart so large (500MB+) videos don't get fully buffered.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const videoUrl: string = body.video_url;
  const groupId: number | string | undefined = body.group_id;
  const name: string = body.name || "Видео";

  if (!videoUrl) {
    return NextResponse.json({ detail: "video_url required" }, { status: 400 });
  }

  try {
    const saveParams: Record<string, string> = {
      name: name.slice(0, 128),
      wallpost: "0",
    };
    if (groupId) {
      saveParams.group_id = String(groupId);
    }

    const { data: saveData } = await vkMethod(auth.sessionId, auth.session, "video.save", saveParams);

    if (saveData.error) {
      return NextResponse.json({ detail: `video.save: ${saveData.error.error_msg}`, code: saveData.error.error_code }, { status: 400 });
    }
    const resp = saveData.response as { upload_url?: string; owner_id?: number; video_id?: number } | undefined;
    const uploadUrl = resp?.upload_url;
    const ownerId = resp?.owner_id;
    const videoId = resp?.video_id;
    if (!uploadUrl || !ownerId || !videoId) {
      return NextResponse.json({ detail: "Invalid video.save response" }, { status: 400 });
    }

    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok || !videoResp.body) {
      return NextResponse.json({ detail: `Не удалось загрузить видео из хранилища: ${videoResp.status}` }, { status: 400 });
    }
    const contentType = videoResp.headers.get("content-type") || "video/mp4";
    const extFromUrl = (videoUrl.split("?")[0].split(".").pop() || "mp4").toLowerCase();
    const fileName = `video.${/^[a-z0-9]{2,5}$/.test(extFromUrl) ? extFromUrl : "mp4"}`;

    // Manually construct a streaming multipart/form-data body so we never buffer the
    // full video in memory. undici (Node 24 global fetch) accepts a ReadableStream
    // body with `duplex: "half"`.
    const boundary = `----vkstorm${Date.now()}${Math.random().toString(36).slice(2)}`;
    const encoder = new TextEncoder();
    const preamble = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="video_file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    );
    const epilogue = encoder.encode(`\r\n--${boundary}--\r\n`);
    const videoBody = videoResp.body;

    const multipartStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(preamble);
        const reader = videoBody.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        } catch (err) {
          controller.error(err);
          return;
        }
        controller.enqueue(epilogue);
        controller.close();
      },
      cancel(reason) {
        videoBody.cancel(reason).catch(() => {});
      },
    });

    const uploadResp = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: multipartStream,
      // @ts-expect-error duplex is an undici-specific fetch option required when streaming a request body
      duplex: "half",
    });
    if (!uploadResp.ok) {
      const txt = await uploadResp.text().catch(() => "");
      return NextResponse.json({ detail: `Ошибка загрузки в VK: ${uploadResp.status} ${txt}`.slice(0, 300) }, { status: 400 });
    }

    return NextResponse.json({ attachment: `video${ownerId}_${videoId}`, owner_id: ownerId, video_id: videoId });
  } catch (e) {
    return NextResponse.json({ detail: `Upload failed: ${(e as Error).message}` }, { status: 500 });
  }
}
