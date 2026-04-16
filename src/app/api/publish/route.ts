import { NextResponse } from "next/server";

// Publishing now happens client-side via JSONP.
// This route is kept as a placeholder. Use /api/publish/results to save outcomes.
export async function POST() {
  return NextResponse.json(
    { detail: "Публикация теперь выполняется на стороне клиента. Используйте JSONP VK API." },
    { status: 410 }
  );
}
