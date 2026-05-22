import { NextRequest } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { fetchGroupMembershipMap } from "@/lib/vk-batch-membership";
import { vkMethod } from "@/lib/vk-method";

export const maxDuration = 300;

/** Последовательная публикация — меньше Error 6 при общей очереди vkMethod. */
const BATCH_WALL_POST_CONCURRENCY = 1;
const BETWEEN_GROUPS_MS = 650;

type Group = { id: number; url: string; name: string };
type BatchBody = { postText: string; attachments: string[]; groups: Group[] };

type ProgressEvent =
  | { type: "started"; total: number }
  | { type: "result"; group: Group; success: boolean; error?: string; completed: number; total: number }
  | { type: "done"; success: number; failed: number };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Server-side fan-out of wall.post across N groups. Runs on a single Fluid
 * Compute instance so every call goes out from the same egress IP.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => ({}))) as Partial<BatchBody>;
  const postText = typeof body.postText === "string" ? body.postText : "";
  const attachments = Array.isArray(body.attachments) ? body.attachments.filter((a) => typeof a === "string") : [];
  const groups = Array.isArray(body.groups)
    ? body.groups.filter((g) => g && typeof g.id === "number" && typeof g.url === "string")
    : [];

  if (groups.length === 0) {
    return new Response(JSON.stringify({ detail: "groups required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
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

      const abort = () => {
        closed = true;
      };
      request.signal.addEventListener("abort", abort);

      send({ type: "started", total });

      let success = 0;
      let failed = 0;
      let completed = 0;
      const queue: Group[] = [...groups];

      const { map: membership, session: sessionAfterCheck } = await fetchGroupMembershipMap(
        auth.sessionId,
        auth.session,
        auth.session.user_id,
        groups.map((g) => g.id),
      );
      let currentSession = sessionAfterCheck;

      const publishOne = async (g: Group) => {
        const postParams: Record<string, string> = { owner_id: String(-g.id), message: postText };
        if (attachments.length > 0) postParams.attachments = attachments.join(",");

        let errMsg: string | null = null;

        if (!membership.get(g.id)) {
          errMsg = "Аккаунт VK не подписан на это сообщество";
        } else {
          const { data, session: ns } = await vkMethod(auth.sessionId, currentSession, "wall.post", postParams);
          currentSession = ns;
          if (data.error) {
            const code = data.error.error_code;
            if (code === 1051 || code === 15 || code === 214) {
              await sleep(350 + Math.random() * 350);
              if (closed) return;
              const { data: suggestData, session: ns2 } = await vkMethod(auth.sessionId, currentSession, "wall.post", {
                ...postParams,
                suggest: "1",
              });
              currentSession = ns2;
              if (suggestData.error) {
                errMsg = `Error ${suggestData.error.error_code}: ${suggestData.error.error_msg}`;
              }
            } else {
              errMsg = `Error ${code}: ${data.error.error_msg}`;
            }
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
          if (queue.length > 0 && !closed) {
            await sleep(BETWEEN_GROUPS_MS + Math.floor(Math.random() * 200));
          }
        }
      };

      await Promise.all(Array.from({ length: BATCH_WALL_POST_CONCURRENCY }, () => worker()));

      send({ type: "done", success, failed });
      request.signal.removeEventListener("abort", abort);
      if (!closed) {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
