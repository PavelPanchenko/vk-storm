import { NextResponse } from "next/server";

// SSE status endpoint is no longer needed — publish progress is tracked client-side.
export async function GET() {
  return NextResponse.json(
    { detail: "Статус публикации теперь отслеживается на клиенте." },
    { status: 410 }
  );
}
