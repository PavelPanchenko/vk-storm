import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/mpeg", "video/x-msvideo"];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const isVideo = clientPayload === "video";
        return {
          allowedContentTypes: isVideo ? VIDEO_TYPES : [...IMAGE_TYPES, ...VIDEO_TYPES],
          maximumSizeInBytes: isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ sessionId: auth.sessionId, pathname }),
        };
      },
      onUploadCompleted: async () => {
        // No post-upload work needed — URLs are wired into the post on submit.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
