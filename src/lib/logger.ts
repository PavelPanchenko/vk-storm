import { db } from "./db";
import { logs } from "./db/schema";
import { desc, eq, lt } from "drizzle-orm";

export async function appendLog(level: string, message: string): Promise<void> {
  await db.insert(logs).values({ level: level.toUpperCase(), message });
}

export async function readLogs(level?: string): Promise<string[]> {
  const query = db
    .select()
    .from(logs)
    .orderBy(desc(logs.id))
    .limit(200);

  const rows = level && level !== "all"
    ? await db
        .select()
        .from(logs)
        .where(eq(logs.level, level.toUpperCase()))
        .orderBy(desc(logs.id))
        .limit(200)
    : await query;

  return rows.reverse().map(
    (r) =>
      `${r.createdAt.toISOString().replace("T", " ").substring(0, 19)} - ${r.level} - ${r.message}`,
  );
}

export async function clearLogs(): Promise<void> {
  await db.delete(logs);
}

/** Delete logs older than the given number of days (default 7). */
export async function cleanupOldLogs(days = 7): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  await db.delete(logs).where(lt(logs.createdAt, cutoff));
}
