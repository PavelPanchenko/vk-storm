import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import type { Session } from "./sessions";
import { appendLog } from "./logger";
import { resolveUploadPath } from "./storage";
import { vkMethod } from "./vk-method";
import {
  loadImageBlob,
  optimizeImageForVkUpload,
  parseVkPhotoUploadResult,
  photoAttachmentFromSaveResponse,
} from "./vk-image-blob";

const VIDEO_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".avi": "video/x-msvideo",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const BETWEEN_IMAGES_MS = 500;
const BETWEEN_VK_STEPS_MS = 450;
const UPLOAD_FETCH_TIMEOUT_MS = 120_000;
const MAX_UPLOAD_ATTEMPTS = 4;
const RETRYABLE_UPLOAD_STATUS = new Set([405, 408, 429, 502, 503, 504]);

function uploadRetryDelay(attempt: number): number {
  return 800 * (attempt + 1) + Math.floor(Math.random() * 400);
}

export type MediaUploadResult = {
  attachments: string[];
  errors: string[];
};

export type ImageBlobSource = { blob: Blob; fileName: string; source?: string };

export async function preloadPublishImages(imageUrls: string[]): Promise<ImageBlobSource[]> {
  const sources: ImageBlobSource[] = [];
  for (const url of imageUrls) {
    const loaded = await loadImageBlob(url);
    const { blob, fileName } = await optimizeImageForVkUpload(loaded.blob, loaded.fileName);
    sources.push({ blob, fileName, source: url });
  }
  return sources;
}

async function fetchWallUploadUrl(
  sessionId: string,
  session: Session,
  groupId?: number,
): Promise<{ uploadUrl: string; session: Session }> {
  const params: Record<string, string | number> = {};
  if (groupId != null) params.group_id = groupId;

  const serverCall = await vkMethod(sessionId, session, "photos.getWallUploadServer", params);
  let currentSession = serverCall.session;
  const serverData = serverCall.data;
  if (serverData.error) {
    throw new Error(`Error ${serverData.error.error_code}: ${serverData.error.error_msg}`);
  }
  const uploadUrl = (serverData.response as Record<string, unknown>)?.upload_url as string;
  if (!uploadUrl) throw new Error("photos.getWallUploadServer: нет upload_url");
  return { uploadUrl, session: currentSession };
}

async function postPhotoToVkUploadServer(
  uploadUrl: string,
  blob: Blob,
  fileName: string,
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append("photo", blob, fileName);
  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(UPLOAD_FETCH_TIMEOUT_MS),
  });
  const uploadResult = (await uploadResp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!uploadResp.ok) {
    const err = new Error(
      `Ошибка загрузки на сервер VK: HTTP ${uploadResp.status}${uploadResult.error ? ` — ${String(uploadResult.error)}` : ""}`,
    );
    (err as Error & { status?: number }).status = uploadResp.status;
    throw err;
  }
  return uploadResult;
}

/** Загрузка фото на стену: с group_id — вложения для конкретного сообщества. */
export async function uploadWallPhotosForPublish(
  sessionId: string,
  session: Session,
  imageSources: ImageBlobSource[],
  groupId?: number,
  isAborted?: () => boolean,
): Promise<MediaUploadResult & { session: Session }> {
  const attachments: string[] = [];
  const errors: string[] = [];
  let currentSession = session;

  for (let i = 0; i < imageSources.length; i++) {
    if (isAborted?.()) break;
    if (i > 0) await sleep(BETWEEN_IMAGES_MS);
    const { blob, fileName, source } = imageSources[i];
    try {
      let uploadResult: Record<string, unknown> | null = null;

      for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt++) {
        if (isAborted?.()) break;
        const { uploadUrl, session: ns } = await fetchWallUploadUrl(sessionId, currentSession, groupId);
        currentSession = ns;
        await sleep(BETWEEN_VK_STEPS_MS);

        try {
          uploadResult = await postPhotoToVkUploadServer(uploadUrl, blob, fileName);
          break;
        } catch (e) {
          const status = (e as Error & { status?: number }).status;
          const isTimeout = e instanceof Error && e.name === "TimeoutError";
          const retryable =
            isTimeout || (status != null && RETRYABLE_UPLOAD_STATUS.has(status));
          if (retryable && attempt < MAX_UPLOAD_ATTEMPTS - 1) {
            const reason = isTimeout ? "timeout" : `HTTP ${status}`;
            appendLog(
              "WARNING",
              `VK upload ${reason}, retry ${attempt + 2}/${MAX_UPLOAD_ATTEMPTS} (group ${groupId ?? "user"})`,
            );
            await sleep(uploadRetryDelay(attempt));
            continue;
          }
          throw e;
        }
      }

      if (!uploadResult) throw new Error("Не удалось загрузить фото на сервер VK");
      const { server, photo, hash } = parseVkPhotoUploadResult(uploadResult);

      await sleep(BETWEEN_VK_STEPS_MS);

      const saveParams: Record<string, string | number> = { server, photo, hash };
      if (groupId != null) saveParams.group_id = groupId;

      const saveCall = await vkMethod(sessionId, currentSession, "photos.saveWallPhoto", saveParams);
      currentSession = saveCall.session;
      const saveData = saveCall.data;
      if (saveData.error) {
        throw new Error(`Error ${saveData.error.error_code}: ${saveData.error.error_msg}`);
      }
      const attachment = photoAttachmentFromSaveResponse(saveData.response);
      if (!attachment) throw new Error("photos.saveWallPhoto: пустой ответ");
      attachments.push(attachment);
      appendLog("INFO", `Uploaded wall photo for publish${groupId != null ? ` (group ${groupId})` : ""}: ${source ?? fileName}`);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      errors.push(`Фото ${i + 1}: ${msg}`);
      appendLog("ERROR", `Publish photo upload failed (${source ?? fileName}): ${msg}`);
    }
  }

  return { attachments, errors, session: currentSession };
}

export async function uploadWallVideoForPublish(
  sessionId: string,
  session: Session,
  videoUrl: string,
  name: string,
): Promise<{ attachment: string; session: Session }> {
  const { data: saveData, session: nextSession } = await vkMethod(sessionId, session, "video.save", {
    name: name.slice(0, 128),
    wallpost: "0",
  });
  if (saveData.error) {
    throw new Error(`video.save: ${saveData.error.error_msg}`);
  }
  const resp = saveData.response as { upload_url?: string; owner_id?: number; video_id?: number } | undefined;
  const uploadUrl = resp?.upload_url;
  const ownerId = resp?.owner_id;
  const videoId = resp?.video_id;
  if (!uploadUrl || !ownerId || !videoId) {
    throw new Error("video.save: неполный ответ");
  }

  let videoStream: ReadableStream<Uint8Array>;
  let contentType: string;
  let fileName: string;

  if (videoUrl.startsWith("/uploads/")) {
    const rel = videoUrl.slice("/uploads/".length);
    const abs = resolveUploadPath(rel);
    if (!abs) throw new Error("Некорректный путь к видео");
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) throw new Error("Файл видео не найден");
    const ext = extname(abs).toLowerCase();
    contentType = VIDEO_MIME[ext] || "video/mp4";
    fileName = `video${ext || ".mp4"}`;
    videoStream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream<Uint8Array>;
  } else {
    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok || !videoResp.body) {
      throw new Error(`Не удалось загрузить видео: HTTP ${videoResp.status}`);
    }
    contentType = videoResp.headers.get("content-type") || "video/mp4";
    const extFromUrl = (videoUrl.split("?")[0].split(".").pop() || "mp4").toLowerCase();
    fileName = `video.${/^[a-z0-9]{2,5}$/.test(extFromUrl) ? extFromUrl : "mp4"}`;
    videoStream = videoResp.body;
  }

  const boundary = `----vkstorm${Date.now()}${Math.random().toString(36).slice(2)}`;
  const encoder = new TextEncoder();
  const preamble = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="video_file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const epilogue = encoder.encode(`\r\n--${boundary}--\r\n`);

  const multipartStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(preamble);
      const reader = videoStream.getReader();
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
      videoStream.cancel(reason).catch(() => {});
    },
  });

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: multipartStream,
    // @ts-expect-error duplex required for streaming body in undici
    duplex: "half",
  });
  if (!uploadResp.ok) {
    const txt = await uploadResp.text().catch(() => "");
    throw new Error(`Ошибка загрузки видео в VK: ${uploadResp.status} ${txt}`.slice(0, 300));
  }

  return { attachment: `video${ownerId}_${videoId}`, session: nextSession };
}

export async function uploadPublishVideos(
  sessionId: string,
  session: Session,
  videoUrls: string[],
  videoName: string,
): Promise<MediaUploadResult & { session: Session }> {
  const attachments: string[] = [];
  const errors: string[] = [];
  let currentSession = session;

  for (let i = 0; i < videoUrls.length; i++) {
    if (i > 0) await sleep(BETWEEN_IMAGES_MS);
    try {
      const videoResult = await uploadWallVideoForPublish(sessionId, currentSession, videoUrls[i], videoName);
      currentSession = videoResult.session;
      attachments.push(videoResult.attachment);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      errors.push(`Видео ${i + 1}: ${msg}`);
      appendLog("ERROR", `Publish video upload failed: ${msg}`);
    }
  }

  return { attachments, errors, session: currentSession };
}
