import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getCategories, saveCategory } from "@/lib/groups";

export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  return NextResponse.json(await getCategories(auth.session.user_id));
}

export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120 || /[\u0000-\u001f]/.test(name)) {
    return NextResponse.json({ detail: "Введите название категории длиной до 120 символов" }, { status: 400 });
  }
  const created = await saveCategory(auth.session.user_id, name);
  if (!created) {
    return NextResponse.json({ detail: "Такая категория уже есть" }, { status: 409 });
  }
  return NextResponse.json({ name }, { status: 201 });
}
