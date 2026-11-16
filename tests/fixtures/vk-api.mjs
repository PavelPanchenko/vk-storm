const fetchOriginal = globalThis.fetch;
const exchangedCodes = new Set();
const attempts = new Map();
const joinedGroups = new Set();
const joinRequests = new Set();
const membershipCases = new Set([109, 110, 111]);
const isMember = id => !membershipCases.has(id) || joinedGroups.has(id);

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname === "id.vk.com" && url.pathname === "/oauth2/auth") {
    const params = new URLSearchParams(init?.body);
    const code = params.get("code");
    const state = params.get("state");
    if (!code?.startsWith("test-login-") || !/^[a-f0-9]{32}$/.test(state)
        || !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_verifier")) || params.get("device_id") !== "test-device") {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (exchangedCodes.has(code)) return Response.json({ error: "invalid_grant" }, { status: 400 });
    exchangedCodes.add(code);
    await new Promise(resolve => setTimeout(resolve, 100));
    return Response.json({ access_token: "fake-login-token", expires_in: 3600, user_id: 9001, state });
  }
  if (url.hostname === "upload.vk.test" && url.pathname === "/video") {
    const payload = await new Response(init?.body, { headers: init?.headers }).formData();
    const video = payload.get("video_file");
    if (!(video instanceof Blob) || !video.size) throw new Error("Неверная загрузка тестового видео");
    switch (url.searchParams.get("case")) {
      case "Видео с ошибкой": return Response.json({ error: { error_code: 100, error_msg: "Invalid video" } });
      case "Видео с текстом": return new Response("File is not a video.");
      case "Видео с другим ID": return Response.json({ video_id: 777, size: video.size });
      case "Видео с хешем": return Response.json({ video_hash: "test-upload-hash", size: video.size });
      default: return Response.json({ video_id: 731, owner_id: 1, size: video.size });
    }
  }
  if (url.hostname === "upload.vk.test") {
    const file = init?.body?.get("photo");
    if (url.pathname !== "/103" || !(file instanceof Blob) || !file.size) throw new Error("Неверная загрузка тестового фото");
    return Response.json({ server: 10, hash: "test-hash", photo: JSON.stringify([{ filename: file.name }]) });
  }
  if (url.hostname !== "api.vk.com") return fetchOriginal(input, init);
  const params = new URLSearchParams(init?.body);

  switch (url.pathname) {
    case "/method/users.get":
      return Response.json({ response: [{ id: 9001, first_name: "Тест", last_name: "VK" }] });
    case "/method/groups.getById": {
      const groups = params.get("group_ids").split(",").map(screen_name => {
        const id = screen_name === "closed-test" ? 110 : Number(screen_name.replace("club", ""));
        const needsMembership = (id === 109 || id === 110) && !isMember(id);
        return {
          id,
          name: screen_name,
          screen_name,
          can_post: id === 103 || needsMembership ? 0 : 1,
          can_suggest: id === 107 || needsMembership ? 0 : 1,
        };
      });
      return Response.json({ response: { groups } });
    }
    case "/method/execute": {
      const calls = params.get("code").matchAll(/API\.groups\.isMember\((\{[^}]+\})\)/g);
      return Response.json({ response: [...calls].map(([, args]) => Number(isMember(JSON.parse(args).group_id))) });
    }
    case "/method/groups.join": {
      const id = params.get("group_id");
      if (id === "109") joinedGroups.add(109);
      else if (id === "110") joinRequests.add(110);
      else throw new Error("Ожидался числовой ID сохранённого сообщества");
      return Response.json({ response: 1 });
    }
    case "/method/groups.isMember": {
      const id = Number(params.get("group_id"));
      return Response.json({ response: { member: Number(isMember(id)), request: Number(joinRequests.has(id)) } });
    }
    case "/method/photos.getWallUploadServer": {
      if (params.get("group_id") !== "103") throw new Error("Запросили загрузку на стену другой группы");
      return Response.json({ response: { upload_url: "https://upload.vk.test/103" } });
    }
    case "/method/photos.saveWallPhoto": {
      const [{ filename }] = JSON.parse(params.get("photo"));
      if (params.get("group_id") !== "103" || params.get("server") !== "10" || params.get("hash") !== "test-hash") {
        throw new Error("Неверные данные сохранения тестового фото");
      }
      return Response.json({ response: filename === "private.png"
        ? [{ owner_id: -103, id: 987, access_key: "test-private-key" }]
        : [{ owner_id: -103, id: 988 }] });
    }
    case "/method/video.save": {
      const destination = new URL("https://upload.vk.test/video");
      destination.searchParams.set("case", params.get("name"));
      return Response.json({ response: {
        upload_url: destination.href, owner_id: 1, video_id: 731, access_key: "test-video-key",
      } });
    }
    case "/method/wall.post": {
      const owner = Number(params.get("owner_id"));
      const attempt = (attempts.get(owner) ?? 0) + 1;
      attempts.set(owner, attempt);
      if (owner === -102 && attempt === 1) {
        return Response.json({ error: { error_code: 100, error_msg: "Ошибка тестовой группы" } });
      }
      if (owner === -103 && !params.has("suggest")) {
        return Response.json({ error: { error_code: 15, error_msg: "Доступна предложка" } });
      }
      if (owner === -103 && params.get("message") === "Текст поста с фото"
        && params.get("attachments") !== "photo-103_987_test-private-key,photo-103_988") {
        return Response.json({ error: { error_code: 100, error_msg: "Неверный идентификатор вложения" } });
      }
      if (params.get("message") === "Успешное видео" && params.get("attachments") !== "video1_731_test-video-key") {
        return Response.json({ error: { error_code: 100, error_msg: "Неверный идентификатор видео" } });
      }
      if (params.get("message") === "Неотправленное видео") throw new Error("Пост отправлен без подтверждения загрузки");
      if (owner === -104) throw new Error("Нет ответа VK");
      if (owner === -105) return Response.json({ response: {} });
      if (owner === -106 && !params.has("suggest")) {
        return Response.json({ error: { error_code: 15, error_msg: "Нет доступа к вложению" } });
      }
      if ((owner === -107 || owner === -108) && !params.has("suggest")) {
        return Response.json({ error: { error_code: 214, error_msg: "Публикация на стене запрещена" } });
      }
      if ((owner === -109 || owner === -110) && !isMember(-owner)) throw new Error("Отправка до вступления");
      if (owner === -202) await new Promise(resolve => setTimeout(resolve, 5000));
      return Response.json({ response: { post_id: 123 } });
    }
    default:
      throw new Error(`Unexpected VK API method: ${url.pathname}`);
  }
};
