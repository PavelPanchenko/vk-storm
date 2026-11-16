const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const VIDEO_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/mpeg": "mpeg",
  "video/x-msvideo": "avi",
};

export const mediaUploadConfig = {
  image: { extensions: IMAGE_EXTENSIONS, maxBytes: 20 * 1024 * 1024 },
  video: { extensions: VIDEO_EXTENSIONS, maxBytes: 500 * 1024 * 1024 },
};

export function isMediaKind(value: unknown): value is keyof typeof mediaUploadConfig {
  return value === "image" || value === "video";
}

export function privateBlobPath(url: string): string | null {
  const match = /^\/uploads\/(blob\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.[a-z]{3,4})$/.exec(url);
  return match?.[1] ?? null;
}
