import { del, get } from "@vercel/blob";

export function privateBlobToken() {
  return process.env.VKSTORM_BLOB_READ_WRITE_TOKEN;
}

export async function readPrivateBlob(pathname: string, range?: string, signal?: AbortSignal) {
  const token = privateBlobToken();
  if (!token) return null;
  const result = await get(pathname, {
    token,
    access: "private",
    headers: range ? { Range: range } : undefined,
    abortSignal: signal,
  });
  return result?.statusCode === 200 ? result : null;
}

export async function deletePrivateBlob(pathname: string) {
  const token = privateBlobToken();
  if (!token) throw new Error("Приватное хранилище вложений недоступно");
  await del(pathname, { token });
}
