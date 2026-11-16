import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { groups } from "@/lib/db/schema";
import { appendLog } from "@/lib/logger";
import { updateGroupCategory } from "@/lib/groups";

type Params = { params: Promise<{ id: string }> };

async function groupId(params: Params["params"]) {
  const { id } = await params;
  const value = Number(id);
  return /^[1-9]\d*$/.test(id) && value <= 2147483647 ? value : null;
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const id = await groupId(params);
  if (id === null) return NextResponse.json({ detail: "Некорректный ID группы" }, { status: 400 });
  const [removed] = await db.delete(groups)
    .where(and(eq(groups.userId, auth.session.user_id), eq(groups.id, id)))
    .returning({ url: groups.url });
  if (!removed) return NextResponse.json({ detail: "Группа не найдена" }, { status: 404 });
  await appendLog("INFO", `Группа удалена: ${removed.url}`, auth.session.user_id);
  return NextResponse.json({ status: "ok" });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const id = await groupId(params);
  if (id === null) return NextResponse.json({ detail: "Некорректный ID группы" }, { status: 400 });
  const body = await request.json().catch(() => null);
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  if (!category) return NextResponse.json({ detail: "Категория обязательна" }, { status: 400 });
  const updated = await updateGroupCategory(auth.session.user_id, id, category);
  if (!updated) return NextResponse.json({ detail: "Группа не найдена" }, { status: 404 });
  return NextResponse.json({ status: "ok" });
}
