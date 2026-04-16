import crypto from "crypto";
import { db } from "./db";
import { sessions } from "./db/schema";
import { eq } from "drizzle-orm";

export interface Session {
  access_token: string;
  refresh_token: string;
  device_id: string;
  user_id: string;
  user_name: string;
  user_photo: string;
  expires_at: number;
}

export async function createSession(
  tokenData: Record<string, unknown>,
  userInfo: Record<string, unknown>,
  deviceId: string,
): Promise<string> {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const firstName = (userInfo.first_name as string) || "";
  const lastName = (userInfo.last_name as string) || "";
  const expiresIn = (tokenData.expires_in as number) || 0;

  await db.insert(sessions).values({
    id: sessionId,
    accessToken: (tokenData.access_token as string) || "",
    refreshToken: (tokenData.refresh_token as string) || "",
    deviceId: deviceId || "",
    userId: String(tokenData.user_id || userInfo.id || ""),
    userName: `${firstName} ${lastName}`.trim(),
    userPhoto: (userInfo.photo_100 as string) || "",
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  });

  return sessionId;
}

export async function getSession(sessionId: string): Promise<Session | undefined> {
  const row = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!row) return undefined;
  return {
    access_token: row.accessToken,
    refresh_token: row.refreshToken,
    device_id: row.deviceId,
    user_id: row.userId,
    user_name: row.userName,
    user_photo: row.userPhoto,
    expires_at: row.expiresAt.getTime(),
  };
}

export async function updateSessionTokens(
  sessionId: string,
  tokenData: Record<string, unknown>,
): Promise<void> {
  const expiresIn = (tokenData.expires_in as number) || 0;
  const update: Record<string, unknown> = {
    accessToken: (tokenData.access_token as string) || "",
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
  if (tokenData.refresh_token) {
    update.refreshToken = tokenData.refresh_token as string;
  }
  await db.update(sessions).set(update).where(eq(sessions.id, sessionId));
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
