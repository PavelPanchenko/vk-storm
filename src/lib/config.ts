import path from "path";

export const VK_APP_ID = process.env.VK_APP_ID || "";
export const VK_APP_SECRET = process.env.VK_APP_SECRET || "";
export const VK_REDIRECT_URI = process.env.VK_REDIRECT_URI || "";

// Posts still use filesystem for image storage
export const DATA_DIR = path.join(process.cwd(), "data");
export const POSTS_DIR = path.join(DATA_DIR, "posts");
