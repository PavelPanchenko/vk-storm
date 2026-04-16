import { NextRequest } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { vkMethod } from "@/lib/vk-method";

export const maxDuration = 300;

type Group = { id: number; url: string; name: string };
type BatchBody = { postText: string; attachments: string[]; groups: Group[] };

type ProgressEvent =
  | { type: "started"; total: number }
  | { type: "result"; group: Group; success: boolean; error?: string; completed: number; total: number }
  | { type: "done"; success: number; failed: number };

/**
 * Server-side fan-out of wall.post across N groups. Runs on a single Fluid
 * Compute instance so every call goes out from the same egress IP — this is
 * what keeps the IP-bound VK user token valid across the whole batch.
 *
 * Streams progress to the client as Server-Sent Events.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => ({}))) as Partial<BatchBody>;
  const postText = typeof body.postText === "string" ? body.postText : "";
  const attachments = Array.isArray(body.attachments) ? body.attachments.filter(a => typeof a === "string") : [];
  const groups = Array.isArray(body.groups) ? body.groups.filter(g => g && typeof g.id === "number" && typeof g.url === "string") : [];

  if (groups.length === 0) {
    return new Response(JSON.stringify({ detail: "groups required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const encoder = new TextEncoder();
  const total = groups.length;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: ProgressEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const abort = () => { closed = true; };
      request.signal.addEventListener("abort", abort);

      send({ type: "started", total });

      let success = 0;
      let failed = 0;
      let completed = 0;
      const queue: Group[] = [...groups];

      const publishOne = async (g: Group) => {
        const postParams: Record<string, string> = { owner_id: String(-g.id), message: postText };
        if (attachments.length > 0) postParams.attachments = attachments.join(",");

        let errMsg: string | null = null;

        const { data } = await vkMethod(auth.sessionId, auth.session, "wall.post", postParams);
        if (data.error) {
          const code = data.error.error_code;
          // 1051/15/214 → стена закрыта, но предложка может быть открыта
          if (code === 1051 || code === 15 || code === 214) {
            await new Promise(r => setTimeout(r, 350 + Math.random() * 350));
            if (closed) return;
            const { data: suggestData } = await vkMethod(auth.sessionId, auth.session, "wall.post", { ...postParams, suggest: "1" });
            if (suggestData.error) {
              errMsg = `Error ${suggestData.error.error_code}: ${suggestData.error.error_msg}`;
            }
          } else {
            errMsg = `Error ${code}: ${data.error.error_msg}`;
          }
        }

        if (errMsg) failed++;
        else success++;
        completed++;

        send({
          type: "result",
          group: g,
          success: !errMsg,
          error: errMsg || undefined,
          completed,
          total,
        });
      };

      const worker = async () => {
        while (queue.length > 0 && !closed) {
          const g = queue.shift();
          if (!g) return;
          try {
            await publishOne(g);
          } catch (e) {
            failed++;
            completed++;
            send({
              type: "result",
              group: g,
              success: false,
              error: (e as Error).message || "Неизвестная ошибка",
              completed,
              total,
            });
          }
        }
      };

      // Concurrency 3 matches VK's ~3 req/s user-token budget; vkMethod itself
      // handles Error 6 / Error 10 backoff if we still hit the ceiling.
      await Promise.all([worker(), worker(), worker()]);

      send({ type: "done", success, failed });
      request.signal.removeEventListener("abort", abort);
      if (!closed) {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
