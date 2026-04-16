/** Последний сегмент пути ссылки на сообщество, lower case, без query. */
export function vkGroupPathKey(url: string): string {
  const seg = url.replace(/\/$/, "").split("/").pop() || "";
  return seg.split("?")[0].toLowerCase();
}

/** Числовой id из club123 / public123 / event123; иначе null. */
export function vkNumericGroupIdFromUrl(url: string): number | null {
  const key = vkGroupPathKey(url);
  const m = key.match(/^(club|public|event)(\d+)$/);
  return m ? Number(m[2]) : null;
}
