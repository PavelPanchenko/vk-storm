import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readGroupRows, removeGroup, updateGroupCategory } from "@/lib/groups";
import { appendLog } from "@/lib/logger";

type Params = { params: Promise<{ index: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  const result = await requireSession();
  if (result.error) return result.error;
  const { index: indexStr } = await params;
  const index = parseInt(indexStr, 10);
  const rows = await readGroupRows();
  if (index < 0 || index >= rows.length) {
    return NextResponse.json({ detail: "Группа не найдена" }, { status: 404 });
  }
  const removed = rows[index];
  await removeGroup(removed.url);
  await appendLog("INFO", `Group removed: ${removed.url}`);
  return NextResponse.json({ status: "ok" });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const result = await requireSession();
  if (result.error) return result.error;
  const { index: indexStr } = await params;
  const index = parseInt(indexStr, 10);
  const rows = await readGroupRows();
  if (index < 0 || index >= rows.length) {
    return NextResponse.json({ detail: "Группа не найдена" }, { status: 404 });
  }
  const body = await request.json();
  const category = (body.category || "").trim();
  if (!category) return NextResponse.json({ detail: "Категория обязательна" }, { status: 400 });
  await updateGroupCategory(rows[index].url, category);
  return NextResponse.json({ status: "ok" });
}
