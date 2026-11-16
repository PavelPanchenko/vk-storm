const fetchOriginal = globalThis.fetch;
const attempts = new Map();

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== "api.vk.com") return fetchOriginal(input, init);
  const params = new URLSearchParams(init?.body);

  switch (url.pathname) {
    case "/method/groups.getById": {
      const groups = params.get("group_ids").split(",").map(screen_name => ({
        id: Number(screen_name.replace("club", "")),
        name: screen_name,
        screen_name,
      }));
      return Response.json({ response: { groups } });
    }
    case "/method/execute": {
      const count = (params.get("code").match(/API.groups.isMember/g) ?? []).length;
      return Response.json({ response: Array(count).fill(1) });
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
      if (owner === -104) throw new Error("Нет ответа VK");
      if (owner === -202) await new Promise(resolve => setTimeout(resolve, 5000));
      return Response.json({ response: { post_id: 123 } });
    }
    default:
      throw new Error(`Unexpected VK API method: ${url.pathname}`);
  }
};
