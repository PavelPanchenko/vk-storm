import { and, eq, inArray, sql } from "drizzle-orm";
import { deletePrivateBlob } from "./blob-storage";
import { privateBlobPath } from "./media-upload-config";
import { db } from "./db";
import { mediaUploads, posts } from "./db/schema";
import { deleteUpload } from "./storage";

function attachmentReference(url: string) {
  return sql<boolean>`(${url} = any(${posts.images}) or ${url} = any(${posts.videos}))`;
}

export async function canReadAttachment(userId: string, url: string) {
  const [upload] = await db.select({ userId: mediaUploads.userId })
    .from(mediaUploads).where(eq(mediaUploads.url, url));
  if (upload) return upload.userId === userId;
  const [post] = await db.select({ id: posts.id }).from(posts)
    .where(and(eq(posts.userId, userId), attachmentReference(url))).limit(1);
  return Boolean(post);
}

export async function ownsNewAttachments(userId: string, urls: string[]) {
  const unique = [...new Set(urls)];
  if (!unique.length) return true;
  const matches = await db.select({ url: mediaUploads.url }).from(mediaUploads)
    .where(and(eq(mediaUploads.userId, userId), inArray(mediaUploads.url, unique)));
  return matches.length === unique.length;
}

export async function deleteUnusedAttachments(userId: string, urls: string[]) {
  for (const url of new Set(urls)) {
    if (!url.startsWith("/uploads/")) continue;
    const [used] = await db.select({ id: posts.id }).from(posts).where(attachmentReference(url)).limit(1);
    if (used) continue;
    const [upload] = await db.select({ userId: mediaUploads.userId })
      .from(mediaUploads).where(eq(mediaUploads.url, url));
    if (upload && upload.userId !== userId) continue;
    const pathname = privateBlobPath(url);
    if (pathname) {
      if (!upload) continue;
      try {
        await deletePrivateBlob(pathname);
      } catch {
        console.error("Не удалось удалить неиспользуемое вложение из Blob");
        continue;
      }
    } else {
      await deleteUpload(url);
    }
    await db.delete(mediaUploads).where(and(eq(mediaUploads.url, url), eq(mediaUploads.userId, userId)));
  }
}
