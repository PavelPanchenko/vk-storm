import { createRequire } from "node:module";
import { defineConfig } from "drizzle-kit";

// In local dev, load .env.local via dotenv if available. In Docker, env vars
// come from the container runtime and dotenv is not bundled into the image.
try {
  const require = createRequire(import.meta.url);
  require("dotenv").config({ path: ".env.local" });
} catch {
  // dotenv not installed in this environment — continue with process.env as-is.
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
