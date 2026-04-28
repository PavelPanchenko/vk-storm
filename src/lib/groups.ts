import { db } from "./db";
import { groups, publishResults } from "./db/schema";
import { and, eq, sql } from "drizzle-orm";

export interface GroupRow {
  id: number;
  url: string;
  category: string;
  photo: string;
  membersCount: number;
}

export async function readGroupRows(userId: string): Promise<GroupRow[]> {
  const rows = await db
    .select({ id: groups.id, url: groups.url, category: groups.category, photo: groups.photo, membersCount: groups.membersCount })
    .from(groups)
    .where(eq(groups.userId, userId));
  return rows;
}

export async function readGroups(userId: string): Promise<string[]> {
  const rows = await db.select({ url: groups.url }).from(groups).where(eq(groups.userId, userId));
  return rows.map((r) => r.url);
}

export async function addGroup(userId: string, url: string, category = "Без категории", photo = "", membersCount = 0): Promise<void> {
  await db.insert(groups).values({ userId, url, category, photo, membersCount }).onConflictDoNothing();
}

export async function removeGroup(userId: string, url: string): Promise<void> {
  await db.delete(groups).where(and(eq(groups.userId, userId), eq(groups.url, url)));
}

export async function updateGroupCategory(userId: string, url: string, category: string): Promise<void> {
  await db.update(groups).set({ category }).where(and(eq(groups.userId, userId), eq(groups.url, url)));
}

export async function updateGroupPhoto(userId: string, url: string, photo: string): Promise<void> {
  await db.update(groups).set({ photo }).where(and(eq(groups.userId, userId), eq(groups.url, url)));
}

export async function updateGroupMembersCount(userId: string, url: string, membersCount: number): Promise<void> {
  await db.update(groups).set({ membersCount }).where(and(eq(groups.userId, userId), eq(groups.url, url)));
}

export async function getCategories(userId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ category: groups.category }).from(groups).where(eq(groups.userId, userId));
  return rows.map((r) => r.category);
}

export async function getPublishStats(userId: string): Promise<Record<string, { lastPublished: string; totalPublished: number }>> {
  const rows = await db
    .select({
      groupUrl: publishResults.groupUrl,
      lastPublished: sql<string>`max(${publishResults.createdAt})`.as("last_published"),
      totalPublished: sql<number>`count(*) filter (where ${publishResults.success} = true)`.as("total_published"),
    })
    .from(publishResults)
    .where(eq(publishResults.userId, userId))
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
