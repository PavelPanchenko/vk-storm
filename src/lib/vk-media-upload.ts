import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import type { Session } from "./sessions";
import { appendLog } from "./logger";
import { readPrivateBlob } from "./blob-storage";
import { privateBlobPath } from "./media-upload-config";
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

const BETWEEN_IMAGES_MS = 500;
const BETWEEN_VK_STEPS_MS = 450;
const PHOTO_UPLOAD_TIMEOUT_MS = 25_000;
const VIDEO_UPLOAD_TIMEOUT_MS = 240_000;
const MAX_UPLOAD_ATTEMPTS = 4;
const RETRYABLE_UPLOAD_STATUS = new Set([405, 408, 429, 500, 502, 503, 504]);

function mediaSignal(timeout: number, signal?: AbortSignal) {
  const timer = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

function uploadRetryDelay(attempt: number): number {
  return 800 * (attempt + 1) + Math.floor(Math.random() * 400);
}

function isRetryableVkUploadError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "TimeoutError" || (e instanceof TypeError && e.message === "fetch failed")) return true;
  const status = (e as Error & { status?: number }).status;
  if (status != null && RETRYABLE_UPLOAD_STATUS.has(status)) return true;
  return e.message.includes("пустой photo") || e.message.includes("Неполный ответ VK upload server");
}

export type MediaUploadResult = {
  attachments: string[];
  errors: string[];
};

export type ImageBlobSource = { blob: Blob; fileName: string };

export async function preloadPublishImages(imageUrls: string[], signal?: AbortSignal): Promise<ImageBlobSource[]> {
  const sources: ImageBlobSource[] = [];
  for (const url of imageUrls) {
    signal?.throwIfAborted();
    const loaded = await loadImageBlob(url, mediaSignal(PHOTO_UPLOAD_TIMEOUT_MS, signal));
    const { blob, fileName } = await optimizeImageForVkUpload(loaded.blob, loaded.fileName);
    sources.push({ blob, fileName });
  }
  return sources;
}

async function fetchWallUploadUrl(
  sessionId: string,
  session: Session,
  groupId?: number,
  signal?: AbortSignal,
): Promise<{ uploadUrl: string; session: Session }> {
  const params: Record<string, string | number> = {};
  if (groupId != null) params.group_id = groupId;

  const serverCall = await vkMethod(sessionId, session, "photos.getWallUploadServer", params, signal);
  const currentSession = serverCall.session;
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
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append("photo", blob, fileName);
  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    signal: mediaSignal(PHOTO_UPLOAD_TIMEOUT_MS, signal),
  });
  if (!uploadResp.ok) {
    await uploadResp.body?.cancel().catch(() => {});
    const err = new Error(`Ошибка загрузки на сервер VK: HTTP ${uploadResp.status}`);
    (err as Error & { status?: number }).status = uploadResp.status;
    throw err;
  }
  const result: unknown = await uploadResp.json().catch(error => {
    if (error instanceof SyntaxError) return null;
    throw error;
  });
  return result && typeof result === "object" ? result as Record<string, unknown> : {};
}

/** Загрузка фото на стену: с group_id — вложения для конкретного сообщества. */
export async function uploadWallPhotosForPublish(
  sessionId: string,
  session: Session,
  imageSources: ImageBlobSource[],
  groupId?: number,
  signal?: AbortSignal,
): Promise<MediaUploadResult & { session: Session }> {
  const attachments: string[] = [];
  const errors: string[] = [];
  let currentSession = session;

  for (let i = 0; i < imageSources.length; i++) {
    try {
      signal?.throwIfAborted();
      if (i > 0) await sleep(BETWEEN_IMAGES_MS, undefined, { signal });
      const { blob, fileName } = imageSources[i];
      let uploadResult: Record<string, unknown> | null = null;

      for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt++) {
        const { uploadUrl, session: ns } = await fetchWallUploadUrl(sessionId, currentSession, groupId, signal);
        currentSession = ns;
        await sleep(BETWEEN_VK_STEPS_MS, undefined, { signal });

        try {
          const raw = await postPhotoToVkUploadServer(uploadUrl, blob, fileName, signal);
          parseVkPhotoUploadResult(raw);
          uploadResult = raw;
          break;
        } catch (e) {
          signal?.throwIfAborted();
          if (isRetryableVkUploadError(e) && attempt < MAX_UPLOAD_ATTEMPTS - 1) {
            const reason =
              e instanceof Error && e.name === "TimeoutError"
                ? "timeout"
                : (e as Error & { status?: number }).status != null
                  ? `HTTP ${(e as Error & { status?: number }).status}`
                  : (e as Error).message;
            void appendLog(
              "WARNING",
              `Фото ${i + 1}: ${reason}. Повтор ${attempt + 2}/${MAX_UPLOAD_ATTEMPTS}, сообщество ${groupId ?? "user"}`,
              session.user_id,
            ).catch(error => console.error("Photo retry log failed", error));
            await sleep(uploadRetryDelay(attempt), undefined, { signal });
            continue;
          }
          throw e;
        }
      }

      if (!uploadResult) throw new Error("Не удалось загрузить фото на сервер VK");
      const { server, photo, hash } = parseVkPhotoUploadResult(uploadResult);

      await sleep(BETWEEN_VK_STEPS_MS, undefined, { signal });

      const saveParams: Record<string, string | number> = { server, photo, hash };
      if (groupId != null) saveParams.group_id = groupId;

      const saveCall = await vkMethod(sessionId, currentSession, "photos.saveWallPhoto", saveParams, signal);
      currentSession = saveCall.session;
      const saveData = saveCall.data;
      if (saveData.error) {
        throw new Error(`Error ${saveData.error.error_code}: ${saveData.error.error_msg}`);
      }
      const attachment = photoAttachmentFromSaveResponse(saveData.response);
      if (!attachment) throw new Error("photos.saveWallPhoto: пустой ответ");
      attachments.push(attachment);
    } catch (e) {
      if (signal?.aborted) break;
      const msg = (e as Error).message || String(e);
      errors.push(`Фото ${i + 1}: ${msg}`);
      void appendLog("ERROR", `Фото ${i + 1}, сообщество ${groupId ?? "user"}: ${msg}`, session.user_id)
        .catch(error => console.error("Photo failure log failed", error));
    }
  }

  return { attachments, errors, session: currentSession };
}

function videoUploadObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function confirmVkVideoUpload(value: unknown, expectedOwnerId: number, expectedVideoId: number) {
  const envelope = videoUploadObject(value);
  const upload = videoUploadObject(envelope?.response) ?? envelope;
  if (!upload || envelope?.error || envelope?.error_code || upload.error || upload.error_code || upload.success === false || upload.success === 0) {
    throw new Error("Сервер загрузки VK не подтвердил приём видео");
  }

  if (upload.owner_id != null && upload.owner_id !== expectedOwnerId && upload.owner_id !== String(expectedOwnerId)) {
    throw new Error("Сервер загрузки VK вернул другого владельца видео");
  }
  if (upload.video_id != null && upload.video_id !== expectedVideoId && upload.video_id !== String(expectedVideoId)) {
    throw new Error("Сервер загрузки VK вернул другой ID видео");
  }

  const size = typeof upload.size === "number" || typeof upload.size === "string" ? Number(upload.size) : undefined;
  const hasVideoId = upload.video_id != null;
  const hasHashAndSize = typeof upload.video_hash === "string" && Boolean(upload.video_hash.trim()) && size !== undefined && size > 0;
  if ((size !== undefined && (!Number.isSafeInteger(size) || size <= 0)) || (!hasVideoId && !hasHashAndSize)) {
    throw new Error("Сервер загрузки VK не подтвердил приём видео");
  }
}

export async function uploadWallVideoForPublish(
  sessionId: string,
  session: Session,
  videoUrl: string,
  name: string,
  signal?: AbortSignal,
): Promise<{ attachment: string; session: Session }> {
  const uploadSignal = mediaSignal(VIDEO_UPLOAD_TIMEOUT_MS, signal);
  const { data: saveData, session: nextSession } = await vkMethod(sessionId, session, "video.save", {
    name: name.slice(0, 128),
    wallpost: "0",
  }, uploadSignal);
  if (saveData.error) {
    throw new Error(`video.save: ${saveData.error.error_msg}`);
  }
  const resp = saveData.response as { upload_url?: string; owner_id?: number; video_id?: number; access_key?: string } | undefined;
  const uploadUrl = resp?.upload_url;
  const ownerId = resp?.owner_id;
  const videoId = resp?.video_id;
  if (typeof uploadUrl !== "string" || !uploadUrl ||
      typeof ownerId !== "number" || !Number.isSafeInteger(ownerId) || ownerId === 0 ||
      typeof videoId !== "number" || !Number.isSafeInteger(videoId) || videoId <= 0) {
    throw new Error("video.save: неполный ответ");
  }

  let videoStream: ReadableStream<Uint8Array>;
  let contentType: string;
  let fileName: string;

  const pathname = privateBlobPath(videoUrl);
  if (pathname) {
    const result = await readPrivateBlob(pathname, undefined, uploadSignal);
    if (!result) throw new Error("Файл видео не найден");
    const ext = extname(pathname);
    contentType = VIDEO_MIME[ext] || "video/mp4";
    fileName = `video${ext}`;
    videoStream = result.stream;
  } else if (videoUrl.startsWith("/uploads/")) {
    const rel = videoUrl.slice("/uploads/".length);
    const abs = resolveUploadPath(rel);
    if (!abs) throw new Error("Некорректный путь к видео");
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) throw new Error("Файл видео не найден");
    const ext = extname(abs).toLowerCase();
    contentType = VIDEO_MIME[ext] || "video/mp4";
    fileName = `video${ext || ".mp4"}`;
    videoStream = Readable.toWeb(createReadStream(abs, { signal: uploadSignal })) as unknown as ReadableStream<Uint8Array>;
  } else {
    const videoResp = await fetch(videoUrl, { signal: uploadSignal });
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

  const reader = videoStream.getReader();
  const multipartStream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(preamble); },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(epilogue);
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });

  try {
    const uploadResp = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: multipartStream,
      signal: uploadSignal,
      // @ts-expect-error duplex required for streaming body in undici
      duplex: "half",
    });
    if (!uploadResp.ok) {
      await uploadResp.body?.cancel().catch(() => {});
      throw new Error(`Ошибка загрузки видео в VK: HTTP ${uploadResp.status}`);
    }

    confirmVkVideoUpload(await uploadResp.json().catch(() => null), ownerId, videoId);
    const accessKey = typeof resp?.access_key === "string" ? resp.access_key.trim() : "";
    return { attachment: `video${ownerId}_${videoId}${accessKey ? `_${accessKey}` : ""}`, session: nextSession };
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function uploadPublishVideos(
  sessionId: string,
  session: Session,
  videoUrls: string[],
  videoName: string,
  signal?: AbortSignal,
): Promise<MediaUploadResult & { session: Session }> {
  const attachments: string[] = [];
  const errors: string[] = [];
  let currentSession = session;

  for (let i = 0; i < videoUrls.length; i++) {
    try {
      signal?.throwIfAborted();
      if (i > 0) await sleep(BETWEEN_IMAGES_MS, undefined, { signal });
      const videoResult = await uploadWallVideoForPublish(sessionId, currentSession, videoUrls[i], videoName, signal);
      currentSession = videoResult.session;
      attachments.push(videoResult.attachment);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      errors.push(`Видео ${i + 1}: ${msg}`);
      if (signal?.aborted) break;
      void appendLog("ERROR", `Видео ${i + 1}: ${msg}`, session.user_id)
        .catch(error => console.error("Video failure log failed", error));
    }
  }

  return { attachments, errors, session: currentSession };
}
