import { db } from "./db";
import { groups, publishResults } from "./db/schema";
import { eq, desc, sql } from "drizzle-orm";

export interface GroupRow {
  id: number;
  url: string;
  category: string;
  photo: string;
  membersCount: number;
}

export async function readGroupRows(): Promise<GroupRow[]> {
  const rows = await db.select({ id: groups.id, url: groups.url, category: groups.category, photo: groups.photo, membersCount: groups.membersCount }).from(groups);
  return rows;
}

export async function readGroups(): Promise<string[]> {
  const rows = await db.select({ url: groups.url }).from(groups);
  return rows.map((r) => r.url);
}

export async function addGroup(url: string, category = "Без категории", photo = "", membersCount = 0): Promise<void> {
  await db.insert(groups).values({ url, category, photo, membersCount }).onConflictDoNothing();
}

export async function removeGroup(url: string): Promise<void> {
  await db.delete(groups).where(eq(groups.url, url));
}

export async function updateGroupCategory(url: string, category: string): Promise<void> {
  await db.update(groups).set({ category }).where(eq(groups.url, url));
}

export async function updateGroupPhoto(url: string, photo: string): Promise<void> {
  await db.update(groups).set({ photo }).where(eq(groups.url, url));
}

export async function updateGroupMembersCount(url: string, membersCount: number): Promise<void> {
  await db.update(groups).set({ membersCount }).where(eq(groups.url, url));
}

export async function getCategories(): Promise<string[]> {
  const rows = await db.selectDistinct({ category: groups.category }).from(groups);
  return rows.map((r) => r.category);
}

export async function getPublishStats(): Promise<Record<string, { lastPublished: string; totalPublished: number }>> {
  const rows = await db
    .select({
      groupUrl: publishResults.groupUrl,
      lastPublished: sql<string>`max(${publishResults.createdAt})`.as("last_published"),
      totalPublished: sql<number>`count(*) filter (where ${publishResults.success} = true)`.as("total_published"),
    })
    .from(publishResults)
    .groupBy(publishResults.groupUrl);

  const result: Record<string, { lastPublished: string; totalPublished: number }> = {};
  for (const row of rows) {
    result[row.groupUrl] = {
      lastPublished: row.lastPublished,
      totalPublished: Number(row.totalPublished),
    };
  }
  return result;
}
