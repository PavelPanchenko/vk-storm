import { and, eq, inArray } from "drizzle-orm";
import { requireSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { publishBatches, publishResults } from "@/lib/db/schema";
import { appendLog } from "@/lib/logger";
import { canReadAttachment } from "@/lib/media-access";
import { readGroupRows } from "@/lib/groups";
import { getPost } from "@/lib/posts";
import { claimPublishDestination, closePublishBatches, heartbeatPublishBatch } from "@/lib/publish-batches";
import { fetchGroupMembershipMap } from "@/lib/vk-batch-membership";
import { vkGroupPathKey, vkNumericGroupIdFromUrl } from "@/lib/vk-group-url";
import { preloadPublishImages, uploadPublishVideos, uploadWallPhotosForPublish } from "@/lib/vk-media-upload";
import { vkMethod } from "@/lib/vk-method";
import type { PublishEvent, PublishStatus } from "@/lib/publish-status";

export const maxDuration = 300;
const WORK_TIMEOUT_MS = 270_000;
const deadlineMessage = "Истекло время рассылки. Неотправленные группы можно повторить из истории.";
const groupUnavailable = "Сообщество не разрешает публикацию на стене или отправку в предложку.";

type VkGroup = {
  id: number;
  name: string;
  screen_name: string;
  can_post?: 0 | 1 | boolean;
  can_suggest?: 0 | 1 | boolean;
};

function shouldSuggest(group: VkGroup, errorCode: number | undefined): boolean {
  if (group.can_suggest === 0 || group.can_suggest === false) return false;
  if (errorCode === 214) return true;
  // A generic access error can also come from media or token permissions.
  return errorCode === 15
    && (group.can_post === 0 || group.can_post === false)
    && (group.can_suggest === 1 || group.can_suggest === true);
}
const membershipRequired = "Аккаунт VK не подписан на это сообщество. Вступите и проверьте доступ к публикации.";

function requiresMembership(message: string): boolean {
  return /not a member|must (?:join|subscribe)|вступите в|подпишитесь на|не подписан/i.test(message);
}

function lacksBothPublishPermissions(group: VkGroup): boolean {
  return (group.can_post === 0 || group.can_post === false)
    && (group.can_suggest === 0 || group.can_suggest === false);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  const deadline = AbortSignal.timeout(WORK_TIMEOUT_MS);
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const userId = auth.session.user_id;
  const body = await request.json().catch(() => null);
  const batchId = body?.batchId;
  const retryOf = typeof body?.retryOf === "string" ? body.retryOf : null;
  if (typeof batchId !== "string" || !/^[a-f0-9-]{36}$/i.test(batchId) || typeof body?.postName !== "string") {
    return Response.json({ detail: "Некорректные параметры публикации" }, { status: 400 });
  }

  const post = await getPost(userId, body.postName);
  if (!post) return Response.json({ detail: "Пост не найден" }, { status: 404 });
  for (const url of [...post.images, ...post.videos]) {
    if (!await canReadAttachment(userId, url)) return Response.json({ detail: "Вложения поста недоступны" }, { status: 400 });
  }
  const availableGroups = await readGroupRows(userId);
  const selected = new Set(Array.isArray(body.groupIds) ? body.groupIds : []);
  let targets = availableGroups.filter((group) => selected.has(group.id));

  if (retryOf) {
    await closePublishBatches(userId);
    const previous = await db.select({
      status: publishResults.status,
      url: publishResults.groupUrl,
    }).from(publishResults).where(and(
      eq(publishResults.userId, userId),
      eq(publishResults.batchId, retryOf),
      eq(publishResults.postName, post.name),
    ));
    if (previous.some(({ status }) => status === "queued" || status === "sending")) {
      return Response.json({ detail: "Дождитесь окончания предыдущего запуска" }, { status: 409 });
    }
    const retryable = new Set(previous.filter(({ status }) => status === "failed" || status === "skipped").map(({ url }) => url));
    targets = availableGroups.filter(({ url }) => retryable.has(url));
  }
  if (targets.length === 0) return Response.json({ detail: "Нет доступных групп для отправки" }, { status: 400 });

  const claimed = await db.transaction(async (tx) => {
    const [run] = await tx.insert(publishBatches).values({ id: batchId, userId, retryOf })
      .onConflictDoNothing().returning({ id: publishBatches.id });
    if (!run) return false;
    await tx.insert(publishResults).values(targets.map(({ url }) => ({
      batchId,
      userId,
      sessionId: auth.sessionId,
      postName: post.name,
      postText: post.text,
      groupUrl: url,
      groupName: vkGroupPathKey(url),
      success: false,
      status: "queued",
    })));
    return true;
  });
  if (!claimed) return Response.json({ detail: "Этот запуск уже есть в истории" }, { status: 409 });

  let disconnected = request.signal.aborted;
  const client = new AbortController();
  const signal = AbortSignal.any([request.signal, client.signal, deadline]);
  const abort = () => {
    disconnected = true;
    client.abort();
  };
  const runFilter = and(eq(publishResults.batchId, batchId), eq(publishResults.userId, userId));
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      request.signal.addEventListener("abort", abort);
      const sendFrame = (frame: string) => {
        if (disconnected) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          abort();
        }
      };
      const send = (event: PublishEvent) => sendFrame(`data: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(() => {
        sendFrame(": keep-alive\n\n");
        heartbeatPublishBatch(batchId)
          .then(active => { if (!active) abort(); })
          .catch(error => console.error("Publish heartbeat failed", batchId, error));
      }, 20_000);
      heartbeat.unref();
      let session = auth.session;
      let completed = 0;
      let sent = 0;
      let failed = 0;
      const total = targets.length;
      const resolved = new Map<string, VkGroup>();
      const handled = new Set<number>();
      const finish = async (url: string, name: string, status: PublishStatus, error?: string, postUrl?: string, wasSending = false) => {
        const [updated] = await db.update(publishResults).set({
          groupName: name,
          status,
          success: status === "published" || status === "suggested",
          error,
          postUrl,
        }).where(and(
          runFilter,
          eq(publishResults.groupUrl, url),
          wasSending ? inArray(publishResults.status, ["sending", "unknown"]) : eq(publishResults.status, "queued"),
        )).returning({ id: publishResults.id });
        if (!updated) return;
        if (status === "published" || status === "suggested") sent++;
        if (status === "failed") failed++;
        send({ type: "result", group: { url, name }, status, error, completed: ++completed, total });
      };

      let complete = false;
      send({ type: "started", total });
      try {
        if (disconnected) return;
        const keys = [...new Set(targets.map(({ url }) => vkGroupPathKey(url)).filter(Boolean))];
        for (let i = 0; i < keys.length && !disconnected; i += 100) {
          const response = await vkMethod(auth.sessionId, session, "groups.getById", {
            group_ids: keys.slice(i, i + 100).join(","),
            fields: "can_post,can_suggest",
          }, signal);
          session = response.session;
          if (response.data.error) throw new Error(response.data.error.error_msg);
          const payload = response.data.response as VkGroup[] | { groups?: VkGroup[] } | undefined;
          for (const group of Array.isArray(payload) ? payload : payload?.groups ?? []) {
            if (!Number.isSafeInteger(group.id) || group.id <= 0) continue;
            if (group.screen_name) resolved.set(group.screen_name.toLowerCase(), group);
            resolved.set(String(group.id), group);
          }
        }
        if (disconnected) return;

        const resolvedTargets = targets.map(({ url }) => {
          const numericId = vkNumericGroupIdFromUrl(url);
          return { url, group: resolved.get(vkGroupPathKey(url)) ?? (numericId ? resolved.get(String(numericId)) : undefined) };
        });
        const membership = await fetchGroupMembershipMap(auth.sessionId, session, userId,
          [...new Set(resolvedTargets.flatMap(({ group }) => group ? [group.id] : []))], signal);
        session = membership.session;
        if (disconnected) return;

        const hasEligibleTargets = resolvedTargets.some(({ group }) => group && !lacksBothPublishPermissions(group));
        if (hasEligibleTargets && post.images.length) send({ type: "phase", message: "Подготовка фото…" });
        const images = hasEligibleTargets ? await preloadPublishImages(post.images, signal) : [];
        let videos: string[] = [];
        if (hasEligibleTargets && post.videos.length > 0 && !disconnected) {
          send({ type: "phase", message: "Загрузка видео…" });
          const media = await uploadPublishVideos(auth.sessionId, session, post.videos, post.name, signal);
          signal.throwIfAborted();
          if (media.errors.length) throw new Error(media.errors.join("; "));
          videos = media.attachments;
          session = media.session;
        }
        send({ type: "phase", message: "Отправка в сообщества…" });

        for (const { url, group } of resolvedTargets) {
          signal.throwIfAborted();
          if (!group) {
            await finish(url, vkGroupPathKey(url), "failed", "VK не вернул данные сообщества");
            continue;
          }
          const { id, name } = group;
          if (handled.has(id)) {
            await finish(url, name, "duplicate", "Сообщество уже есть в этом запуске");
            continue;
          }
          handled.add(id);
          const isMember = membership.map.get(id);
          if (lacksBothPublishPermissions(group)) {
            await finish(url, name, "failed", isMember === false ? membershipRequired : groupUnavailable);
            continue;
          }

          const attachments = [...videos];
          if (images.length) {
            send({ type: "phase", message: `Загрузка фото для «${name}»…` });
            const photos = await uploadWallPhotosForPublish(auth.sessionId, session, images, id, signal);
            session = photos.session;
            signal.throwIfAborted();
            if (photos.errors.length || photos.attachments.length !== images.length) {
              const message = photos.errors.join("; ") || "Не удалось загрузить фото";
              await finish(url, name, "failed", isMember !== true && requiresMembership(message) ? membershipRequired : message);
              continue;
            }
            attachments.push(...photos.attachments);
          }

          if (!await claimPublishDestination(userId, batchId, url, name)) {
            send({ type: "interrupted" });
            break;
          }
          const finishDelivery = (status: PublishStatus, error?: string, postUrl?: string) =>
            finish(url, name, status, error, postUrl, true);
          if (signal.aborted) {
            await finishDelivery("skipped");
            signal.throwIfAborted();
          }
          const params = { owner_id: -id, message: post.text, ...(attachments.length ? { attachments: attachments.join(",") } : {}) };
          let reply;
          let suggested = false;
          try {
            // Let an in-flight write receive its reply when a viewer disconnects.
            reply = await vkMethod(auth.sessionId, session, "wall.post", params, deadline);
            session = reply.session;
            if (!signal.aborted && shouldSuggest(group, reply.data.error?.error_code)) {
              await sleep(400);
              if (!signal.aborted) {
                suggested = true;
                reply = await vkMethod(auth.sessionId, session, "wall.post", { ...params, suggest: 1 }, deadline);
                session = reply.session;
              }
            }
          } catch {
            await finishDelivery("unknown", "Связь с VK прервалась во время отправки");
            continue;
          }

          if (reply.data.error) {
            const { error_code, error_msg } = reply.data.error;
            const membershipDenied = isMember !== true && requiresMembership(error_msg)
              || isMember === false && error_code === 214;
            await finishDelivery(error_code === 10 ? "unknown" : "failed",
              membershipDenied ? membershipRequired : `VK ${error_code}: ${error_msg}`);
          } else {
            const postId = (reply.data.response as { post_id?: unknown } | undefined)?.post_id;
            if (typeof postId === "number" && Number.isSafeInteger(postId) && postId > 0) {
              const postUrl = suggested ? undefined : `https://vk.com/wall-${id}_${postId}`;
              await finishDelivery(suggested ? "suggested" : "published", undefined, postUrl);
            } else {
              await finishDelivery("unknown", "VK не вернул ID записи");
            }
          }
          if (!disconnected && completed < total) await sleep(650);
        }
        if (!disconnected) {
          await appendLog(failed ? "WARNING" : "INFO", `Публикация «${post.name}»: отправлено ${sent} из ${total}`, userId)
            .catch(error => console.error("Unable to log publication", error));
          complete = completed === total;
        }
      } catch (error) {
        if (disconnected) return;
        const message = deadline.aborted ? deadlineMessage : error instanceof Error ? error.message : "Не удалось продолжить отправку";
        console.error("Batch publish interrupted", batchId, message);
        await db.update(publishResults).set({ error: message })
          .where(and(runFilter, eq(publishResults.status, "queued")));
        send({ type: "interrupted", message });
      } finally {
        clearInterval(heartbeat);
        try {
          await closePublishBatches(userId, batchId);
          if (complete) send({ type: "done" });
        } finally {
          request.signal.removeEventListener("abort", abort);
          try { controller.close(); } catch {}
        }
      }
    },
    cancel: abort,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
