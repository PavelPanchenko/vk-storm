import { pgTable, text, integer, timestamp, boolean, serial, json } from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  deviceId: text("device_id").notNull().default(""),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userPhoto: text("user_photo").notNull().default(""),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  category: text("category").notNull().default("Без категории"),
  photo: text("photo").notNull().default(""),
  membersCount: integer("members_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  text: text("text").notNull().default(""),
  images: text("images").array().notNull().default([]),
  videos: text("videos").array().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blacklist = pgTable("blacklist", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


export const publishResults = pgTable("publish_results", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  batchId: text("batch_id").notNull().default(""),
  postName: text("post_name").notNull(),
  postText: text("post_text").notNull().default(""),
  groupUrl: text("group_url").notNull(),
  groupName: text("group_name").notNull().default(""),
  success: boolean("success").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
