import { db } from "./db";
import { logs } from "./db/schema";
import { and, desc, eq, lt } from "drizzle-orm";

export async function appendLog(level: string, message: string, userId?: string): Promise<void> {
  if (!userId) {
    console.log(`[${level}] ${message}`);
    return;
  }
  await db.insert(logs).values({ userId, level: level.toUpperCase(), message });
}

export function readLogs(userId: string, level?: string, limit = 200) {
  return db
    .select({ createdAt: logs.createdAt, level: logs.level, message: logs.message })
    .from(logs)
    .where(and(eq(logs.userId, userId), level && level !== "all" ? eq(logs.level, level.toUpperCase()) : undefined))
    .orderBy(desc(logs.id))
    .limit(limit);
}

export async function clearLogs(userId: string): Promise<void> {
  await db.delete(logs).where(eq(logs.userId, userId));
}

export async function cleanupOldLogs(userId: string, days = 7): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  await db.delete(logs).where(and(eq(logs.userId, userId), lt(logs.createdAt, cutoff)));
}
