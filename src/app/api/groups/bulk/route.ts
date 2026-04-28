import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readGroups, addGroup, removeGroup, updateGroupCategory } from "@/lib/groups";
import { appendLog } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  const body = await request.json();
  const urlsRaw = body.urls || "";
  const category = (body.category || "Без категории").trim();
  let urls: string[];
  if (Array.isArray(urlsRaw)) {
    urls = urlsRaw;
  } else {
    urls = urlsRaw.split("\n").map((u: string) => u.trim()).filter(Boolean);
  }

  // Extract URLs from markdown links like [text](url) or bare URLs
  urls = urls.map((raw: string) => {
    const mdMatch = raw.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
    if (mdMatch) return mdMatch[1];
    const urlMatch = raw.match(/(https?:\/\/\S+)/);
    if (urlMatch) return urlMatch[1];
    return raw;
  });

  if (urls.length === 0) {
    return NextResponse.json({ detail: "Список URL пуст" }, { status: 400 });
  }

  const existing = new Set(await readGroups(result.session.user_id));
  let added = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const url of urls) {
    if (!url.startsWith("http")) {
      errors.push(`Пропущен (не URL): ${url}`);
      continue;
    }
    if (existing.has(url)) {
      skipped++;
      continue;
    }
    await addGroup(result.session.user_id, url, category);
    existing.add(url);
    added++;
  }

  await appendLog("INFO", `Bulk import: added=${added}, skipped=${skipped}, errors=${errors.length}`);
  return NextResponse.json({ added, skipped, errors });
}

export async function DELETE(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  const body = await request.json();
  const urls: string[] = body.urls || [];

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ detail: "Список URL пуст" }, { status: 400 });
  }

  let deleted = 0;
  for (const url of urls) {
    await removeGroup(result.session.user_id, url);
    deleted++;
  }

  await appendLog("INFO", `Bulk delete: ${deleted} groups removed`);
  return NextResponse.json({ deleted });
}

export async function PATCH(request: NextRequest) {
  const result = await requireSession();
  if (result.error) return result.error;

  const body = await request.json();
  const urls: string[] = body.urls || [];
  const category = (body.category || "").trim();

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ detail: "Список URL пуст" }, { status: 400 });
  }
  if (!category) {
    return NextResponse.json({ detail: "Категория обязательна" }, { status: 400 });
  }

  let moved = 0;
  for (const url of urls) {
    await updateGroupCategory(result.session.user_id, url, category);
    moved++;
  }

  await appendLog("INFO", `Bulk move: ${moved} groups → ${category}`);
  return NextResponse.json({ moved });
}
