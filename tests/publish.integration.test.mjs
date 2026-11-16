import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { upload } from "@vercel/blob/client";

const database = process.env.VKSTORM_TEST_DATABASE_URL;
const originFile = new URL("../", import.meta.url);
const cwd = fileURLToPath(originFile);

async function ephemeralPort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("публикации, отмена и изоляция аккаунтов", {
  skip: database ? false : "Задайте VKSTORM_TEST_DATABASE_URL",
  timeout: 90_000,
}, async t => {
  const schema = `vkstorm_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(database);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Тест принимает только локальную базу");
  const admin = postgres(url.href, { max: 1, onnotice: () => {} });
  await admin`create schema ${admin(schema)}`;
  t.after(async () => {
    await admin`drop schema ${admin(schema)} cascade`;
    await admin.end();
  });

  url.searchParams.set("search_path", schema);
  const sql = postgres(url.href, { max: 1, onnotice: () => {} });
  t.after(() => sql.end());
  await migrate(drizzle(sql), { migrationsFolder: join(cwd, "drizzle"), migrationsSchema: schema });
  await sql`insert into sessions (id, access_token, refresh_token, user_id, user_name, expires_at)
    values ('test-a', 'fake-token-a', '', '1', 'Анна', now() + interval '1 hour'),
           ('test-b', 'fake-token-b', '', '2', 'Борис', now() + interval '1 hour')`;
  const targets = await sql`insert into groups (user_id, url)
    values ('1', 'https://vk.com/club101'), ('1', 'https://vk.com/club102'),
           ('1', 'https://vk.com/club103'), ('1', 'https://vk.com/club104'),
           ('1', 'https://vk.com/club201'), ('1', 'https://vk.com/club202'),
           ('2', 'https://vk.com/club301') returning id, url`;
  const ids = targets.map(({ id }) => id);
  await sql`insert into posts (user_id, name, text)
    values ('1', 'Первый пост', 'Текст публикации'), ('1', 'Проверка отмены', 'Текст'),
           ('2', 'Другой пост', 'Личный пост')`;
  await sql`insert into logs (user_id, level, message) values
    ('1', 'INFO', 'Только Анна'), ('2', 'INFO', 'Только Борис'), (null, 'DEBUG', 'Старый общий лог')`;
  await sql`insert into publish_results (session_id, user_id, batch_id, post_name, group_url, success)
    values ('test-a', '1', 'legacy-run', 'Старый пост', 'https://vk.com/club101', true)`;

  const uploads = await mkdtemp(join(tmpdir(), "vkstorm-test-media-"));
  const port = await ephemeralPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "./tests/fixtures/vk-api.mjs", ".next/standalone/server.js"], {
    cwd,
    env: { ...process.env, DATABASE_URL: url.href, UPLOADS_DIR: uploads, PORT: String(port), HOSTNAME: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stopped = once(child, "exit");
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  t.after(async () => {
    child.kill();
    await stopped;
    await rm(uploads, { recursive: true, force: true });
  });

  const request = (path, { account = "a", body, method, signal, headers } = {}) => fetch(origin + path, {
    method: method ?? (body ? "POST" : "GET"),
    signal,
    headers: {
      ...headers,
      ...(account ? { Cookie: `session_id=test-${account}` } : {}),
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    },
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  });

  for (let i = 0; ; i++) {
    const response = await request("/api/auth/me").catch(() => null);
    if (response?.ok) break;
    if (i === 49 || child.exitCode !== null) assert.fail(output);
    await delay(200);
  }

  const history = async (account = "a") => {
    const response = await request("/api/publish/history", { account });
    assert.equal(response.status, 200);
    return response.json();
  };

  await t.test("сохраняет отдельные результаты, включая предложку и неизвестный исход, и повторяет только ошибки", async () => {
    const legacies = await history();
    assert.equal(legacies.find(batch => batch.batchId === "legacy-run").groups[0].status, "sent");

    const batchId = randomUUID();
    const body = { batchId, postName: "Первый пост", groupIds: ids.slice(0, 4) };
    const response = await request("/api/publish/batch", { body });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /"type":"done"/);
    const batch = (await history()).find(batch => batch.batchId === batchId);
    const statuses = Object.fromEntries(batch.groups.map(group => [group.groupUrl, group.status]));
    assert.deepEqual(statuses, Object.fromEntries(targets.slice(0, 4).map(({ url }, index) => [
      url, ["published", "failed", "suggested", "unknown"][index],
    ])));
    assert.equal(batch.canRetry, true);
    assert.match(batch.groups.find(group => group.status === "published").postUrl, /wall-101_123$/);
    assert.equal((await request("/api/publish/batch", { body })).status, 409);

    const retryId = randomUUID();
    const retry = await request("/api/publish/batch", {
      body: { batchId: retryId, retryOf: batchId, postName: body.postName, groupIds: ids },
    });
    assert.equal(retry.status, 200);
    assert.match(await retry.text(), /"type":"done"/);
    const updated = await history();
    const retried = updated.find(batch => batch.batchId === retryId);
    assert.deepEqual(retried.groups.map(group => [group.groupUrl, group.status]), [[targets[1].url, "published"]]);
    assert.equal(updated.find(batch => batch.batchId === batchId).canRetry, false);
    assert.deepEqual(await history("b"), []);
  });

  await t.test("сохраняет отправленную группу при обрыве и помечает оставшуюся как пропущенную", async () => {
    const batchId = randomUUID();
    const controller = new AbortController();
    const response = await request("/api/publish/batch", {
      body: { batchId, postName: "Проверка отмены", groupIds: ids.slice(4, 6) },
      signal: controller.signal,
    });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = "";
    while (!buffered.includes('"status":"published"')) {
      const { done, value } = await reader.read();
      assert.equal(done, false, buffered);
      buffered += value;
    }
    controller.abort();
    await reader.cancel().catch(() => {});
    for (let attempt = 0; attempt < 30; attempt++) {
      const batch = (await history()).find(batch => batch.batchId === batchId);
      const statuses = batch.groups.map(group => group.status).sort();
      if (statuses.includes("skipped")) {
        assert.deepEqual(statuses, ["published", "skipped"]);
        return;
      }
      await delay(100);
    }
    assert.fail("После обрыва осталась необработанная группа");
  });

  await t.test("восстанавливает историю после остановки сервера без повтора неопределённых отправок", async () => {
    const batchId = randomUUID();
    await sql`insert into publish_batches (id, user_id, heartbeat_at) values (${batchId}, '1', now() - interval '6 minutes')`;
    await sql`insert into publish_results (session_id, user_id, batch_id, post_name, group_url, success, status)
      values ('test-a', '1', ${batchId}, 'Проверка отмены', ${targets[4].url}, false, 'sending'),
             ('test-a', '1', ${batchId}, 'Проверка отмены', ${targets[5].url}, false, 'queued')`;

    const interrupted = (await history()).find(batch => batch.batchId === batchId);
    assert.deepEqual(interrupted.groups.map(group => group.status).sort(), ["skipped", "unknown"]);
    assert.equal(interrupted.canRetry, true);
  });

  await t.test("изолирует журнал, статистику, группы и вложения", async () => {
    const logs = await (await request("/api/logs", { account: "b" })).json();
    assert.equal(logs.lines.length, 1);
    assert.match(logs.lines[0], /Только Борис/);
    await request("/api/logs", { account: "b", method: "DELETE" });
    const stats = await (await request("/api/stats")).json();
    assert.ok(stats.recent_activity.some(event => event.message === "Только Анна"));
    assert.ok(stats.recent_activity.every(event => event.message !== "Только Борис"));
    assert.equal((await request(`/api/groups/${ids[0]}`, { account: "b", method: "DELETE" })).status, 404);
    assert.equal((await request(`/api/groups/${ids[0]}`, { body: { category: "Тест" }, method: "PATCH" })).status, 200);
    const groups = await (await request("/api/groups")).json();
    assert.equal(groups.find(group => group.id === ids[0]).category, "Тест");

    const file = new File([new Uint8Array([137, 80, 78, 71])], "test.png", { type: "image/png" });
    let mediaUrl;
    if (process.env.VKSTORM_BLOB_READ_WRITE_TOKEN) {
      const pathname = `blob/${randomUUID()}.png`;
      const blob = await upload(pathname, file, {
        access: "private",
        clientPayload: "image",
        handleUploadUrl: `${origin}/api/blob/upload`,
        headers: { Cookie: "session_id=test-a" },
      });
      const direct = await fetch(blob.url);
      assert.equal(direct.ok, false);
      await direct.body?.cancel();
      mediaUrl = `/uploads/${pathname}`;
    } else {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", "image");
      const response = await request("/api/blob/upload", { body: form });
      assert.equal(response.status, 200);
      ({ url: mediaUrl } = await response.json());
    }
    const ownerView = await request(mediaUrl);
    assert.equal(ownerView.status, 200);
    assert.equal(ownerView.headers.get("cache-control"), "private, no-store");
    await ownerView.arrayBuffer();
    const part = await request(mediaUrl, { headers: { Range: "bytes=1-2" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 1-2/4");
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), new Uint8Array([80, 78]));
    assert.equal((await request(mediaUrl, { account: null })).status, 401);
    assert.equal((await request(mediaUrl, { account: "b" })).status, 404);
    assert.equal((await request("/api/posts", { account: "b", body: { name: "Не мой файл", images: [mediaUrl] } })).status, 400);
    const post = "Проверка вложения";
    assert.equal((await request("/api/posts", { body: { name: post, images: [mediaUrl] } })).status, 200);
    assert.equal((await request(`/api/posts/${encodeURIComponent(post)}`, { method: "DELETE" })).status, 200);
    assert.equal((await request(mediaUrl)).status, 404);
  });
});
