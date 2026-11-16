import { pgTable, text, integer, timestamp, boolean, serial, index, uniqueIndex } from "drizzle-orm/pg-core";

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

export const groups = pgTable(
  "groups",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    url: text("url").notNull(),
    category: text("category").notNull().default("Без категории"),
    photo: text("photo").notNull().default(""),
    membersCount: integer("members_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    groupsUserUrlUnique: uniqueIndex("groups_user_url_unique").on(table.userId, table.url),
  }),
);

export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    text: text("text").notNull().default(""),
    images: text("images").array().notNull().default([]),
    videos: text("videos").array().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    postsUserNameUnique: uniqueIndex("posts_user_name_unique").on(table.userId, table.name),
  }),
);

export const mediaUploads = pgTable("media_uploads", {
  url: text("url").primaryKey(),
  userId: text("user_id").notNull(),
});

export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  level: text("level").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [index("logs_user_id_id_idx").on(table.userId, table.id)]);

export const blacklist = pgTable(
  "blacklist",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    url: text("url").notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    blacklistUserUrlUnique: uniqueIndex("blacklist_user_url_unique").on(table.userId, table.url),
  }),
);


export const publishBatches = pgTable("publish_batches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  retryOf: text("retry_of"),
  heartbeatAt: timestamp("heartbeat_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  uniqueIndex("publish_batches_retry_unique").on(table.userId, table.retryOf),
]);

export const publishResults = pgTable("publish_results", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id").notNull(),
  batchId: text("batch_id").notNull().default(""),
  postName: text("post_name").notNull(),
  postText: text("post_text").notNull().default(""),
  groupUrl: text("group_url").notNull(),
  groupName: text("group_name").notNull().default(""),
  success: boolean("success").notNull(),
  status: text("status"),
  postUrl: text("post_url"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [index("publish_results_user_batch_idx").on(table.userId, table.batchId)]);
