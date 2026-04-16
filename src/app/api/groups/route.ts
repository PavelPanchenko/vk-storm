import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readGroupRows, addGroup, getPublishStats } from "@/lib/groups";
import { appendLog } from "@/lib/logger";

export async function GET() {
  const result = await requireSession();
  if (result.error) return result.error;
  const rows = await readGroupRows();
  const pubStats = await getPublishStats();
  return NextResponse.json(
    rows.map(r => {
      const ps = pubStats[r.url];
      return {
        url: r.url,
        name: r.url.replace(/\/$/, "").split("/").pop(),
        category: r.category,
        photo: r.photo || "",
        members_count: r.membersCount || 0,
        status: "pending",
        last_published: ps?.lastPublished || null,
        total_published: ps?.totalPublished || 0,
      };
    })
  );
}

export async function POST(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;
  const body = await request.json();
  const url = (body.url || "").trim();
  const category = (body.category || "Без категории").trim();
  const photo = (body.photo || "").trim();
  const membersCount = Number(body.members_count) || 0;

  if (!url) return NextResponse.json({ detail: "URL обязателен" }, { status: 400 });
  if (!url.startsWith("http")) return NextResponse.json({ detail: "URL должен начинаться с http:// или https://" }, { status: 400 });

  await addGroup(url, category, photo, membersCount);
  await appendLog("INFO", `Group added: ${url} [${category}]`);
  return NextResponse.json({ status: "ok" });
}
