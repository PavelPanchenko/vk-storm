import { db } from "./db";
import { posts } from "./db/schema";
import { eq } from "drizzle-orm";

export interface PostInfo {
  name: string;
  text: string;
  image_count: number;
  images: string[];
  videos: string[];
}

export async function getPost(name: string): Promise<PostInfo | null> {
  const rows = await db.select().from(posts).where(eq(posts.name, name)).limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  return { name: row.name, text: row.text, image_count: row.images.length, images: row.images, videos: row.videos || [] };
}

export async function listPosts(): Promise<PostInfo[]> {
  const rows = await db.select().from(posts).orderBy(posts.name);
  return rows.map((r) => ({
    name: r.name,
    text: r.text,
    image_count: r.images.length,
    images: r.images,
    videos: r.videos || [],
  }));
}

export async function createPost(name: string, text: string, imageUrls: string[], videoUrls: string[] = []): Promise<void> {
  await db.insert(posts).values({ name, text, images: imageUrls, videos: videoUrls });
}

export async function updatePost(name: string, text: string, imageUrls: string[], videoUrls: string[] = []): Promise<void> {
  await db.update(posts).set({ text, images: imageUrls, videos: videoUrls }).where(eq(posts.name, name));
}

export async function deletePost(name: string): Promise<void> {
  await db.delete(posts).where(eq(posts.name, name));
}
