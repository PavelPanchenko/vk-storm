import { NextResponse } from "next/server";
import { privateBlobToken } from "@/lib/blob-storage";
import { requireSession } from "@/lib/api-auth";

export async function GET() {
  const result = await requireSession();
  if (result.error) return result.error;
  const session = result.session;
  return NextResponse.json({
    user_id: session.user_id,
    name: session.user_name,
    avatar: session.user_photo,
    direct_blob_upload: Boolean(privateBlobToken()),
  });
}
