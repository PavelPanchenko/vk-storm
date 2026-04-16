import { appendLog } from "./logger";

const VK_API_VERSION = "5.199";
const VK_API_BASE = "https://api.vk.com/method";

export class VKAPIError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(`VK API Error ${code}: ${message}`);
    this.code = code;
  }
}

export class VKClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async apiCall(method: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({
      ...params,
      access_token: this.accessToken,
      v: VK_API_VERSION,
    });
    const resp = await fetch(`${VK_API_BASE}/${method}?${query}`);
    const data = await resp.json();
    if (data.error) {
      throw new VKAPIError(data.error.error_code || 0, data.error.error_msg || "Unknown error");
    }
    return data.response;
  }

  async searchCities(query: string, countryId = 1): Promise<{ id: number; title: string; region?: string }[]> {
    const response = await this.apiCall("database.getCities", {
      country_id: String(countryId),
      q: query,
      need_all: "0",
      count: "10",
    });
    const resp = response as Record<string, unknown>;
    const items = (resp.items as Record<string, unknown>[]) || [];
    return items.map(c => ({
      id: c.id as number,
      title: c.title as string,
      region: c.region as string | undefined,
    }));
  }

  async searchGroups(query: string, count = 20, offset = 0, cityId?: number): Promise<{ total: number; items: Record<string, unknown>[] }> {
    const params: Record<string, string> = {
      q: query,
      count: String(count),
      offset: String(offset),
      fields: "members_count,activity,description,can_post,can_suggest,city",
    };
    if (cityId) params.city_id = String(cityId);
    const response = await this.apiCall("groups.search", params);
    const resp = response as Record<string, unknown>;
    return {
      total: (resp.count as number) || 0,
      items: (resp.items as Record<string, unknown>[]) || [],
    };
  }

  async checkGroups(groupUrls: string[]): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    const batchSize = 25;

    for (let i = 0; i < groupUrls.length; i += batchSize) {
      const batch = groupUrls.slice(i, i + batchSize);
      const screenNames = batch.map(u => u.replace(/\/$/, "").split("/").pop() || "");

      const code = `var results = [];
${screenNames.map((sn, idx) => `var r${idx} = API.groups.getById({"group_id":"${sn}","fields":"can_post,can_suggest,photo_200,members_count"});
results.push(r${idx});`).join("\n")}
return results;`;

      try {
        const response = await this.apiCall("execute", { code });
        const items = response as unknown as (Record<string, unknown> | false)[];
        for (let j = 0; j < batch.length; j++) {
          const raw = items[j];
          if (!raw) {
            results.push({ url: batch[j], status: "error", error: "VK returned empty response" });
            continue;
          }
          const groupArr = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>).groups as Record<string, unknown>[]) || [];
          const gi = (groupArr[0] || {}) as Record<string, unknown>;
          results.push({
            url: batch[j],
            name: gi.name || screenNames[j],
            id: String(gi.id),
            status: "ok",
            can_post: Boolean(gi.can_post),
            photo: (gi.photo_200 as string) || "",
            members_count: (gi.members_count as number) || 0,
          });
        }
      } catch (e) {
        appendLog("ERROR", `Error checking group batch: ${e}`);
        for (const url of batch) {
          results.push({ url, status: "error", error: String(e) });
        }
      }

      if (i + batchSize < groupUrls.length) {
        await new Promise(r => setTimeout(r, 350));
      }
    }
    return results;
  }

  async uploadPhotos(imageUrls: string[], groupId?: number): Promise<string[]> {
    const attachments: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      if (i > 0) await sleep(300 + Math.random() * 400);

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) await sleep(1000);

          const serverParams: Record<string, string> = {};
          if (groupId) serverParams.group_id = String(groupId);

          const uploadServer = await this.apiCall("photos.getWallUploadServer", serverParams);
          const uploadUrl = (uploadServer as Record<string, unknown>).upload_url as string;

          // Fetch image from Blob URL
          const imgResp = await fetch(imageUrls[i]);
          const fileData = await imgResp.arrayBuffer();
          const fileName = new URL(imageUrls[i]).pathname.split("/").pop() || "image.jpg";
          const formData = new FormData();
          formData.append("photo", new Blob([fileData], { type: "image/jpeg" }), fileName);

          const uploadResp = await fetch(uploadUrl, { method: "POST", body: formData });
          const uploadResult = await uploadResp.json();

          if (!uploadResult.photo || uploadResult.photo === "[]") {
            throw new Error("Empty photo in upload response");
          }

          const saveParams: Record<string, string> = {
            server: String(uploadResult.server),
            photo: uploadResult.photo,
            hash: uploadResult.hash,
          };
          if (groupId) saveParams.group_id = String(groupId);

          const saved = await this.apiCall("photos.saveWallPhoto", saveParams);

          if (Array.isArray(saved) && saved.length > 0) {
            const photo = saved[0] as Record<string, unknown>;
            attachments.push(`photo${photo.owner_id}_${photo.id}`);
            appendLog("INFO", `Uploaded photo: ${imageUrls[i]}`);
            break;
          }
        } catch (e) {
          appendLog("ERROR", `Upload error for ${imageUrls[i]} (attempt ${attempt + 1}/2): ${e}`);
        }
      }
    }
    return attachments;
  }

  async publishToGroup(
    groupId: number,
    groupName: string,
    text: string,
    imageUrls: string[]
  ): Promise<{ success: boolean; group_name: string; post_id?: number; error?: string }> {
    try {
      // Try direct post with group photo upload
      try {
        let attachments: string[] = [];
        if (imageUrls.length > 0) {
          attachments = await this.uploadPhotos(imageUrls, groupId);
        }
        const params: Record<string, string> = {
          owner_id: String(-groupId),
          message: text,
        };
        if (attachments.length > 0) {
          params.attachments = attachments.join(",");
        }
        const response = await this.apiCall("wall.post", params);
        const postId = (response as Record<string, unknown>).post_id as number;
        appendLog("INFO", `Published to group ${groupName}, post_id=${postId}`);
        return { success: true, group_name: groupName, post_id: postId };
      } catch (e) {
        if (e instanceof VKAPIError && (e.code === 1051 || e.code === 15 || e.code === 214)) {
          // No direct rights — upload photos to user wall and suggest
          let attachments: string[] = [];
          if (imageUrls.length > 0) {
            attachments = await this.uploadPhotos(imageUrls);
          }
          const params: Record<string, string> = {
            owner_id: String(-groupId),
            message: text,
            suggest: "1",
          };
          if (attachments.length > 0) {
            params.attachments = attachments.join(",");
          }
          const response = await this.apiCall("wall.post", params);
          const postId = (response as Record<string, unknown>).post_id as number;
          appendLog("INFO", `Suggested to group ${groupName}, post_id=${postId}`);
          return { success: true, group_name: groupName, post_id: postId };
        }
        throw e;
      }
    } catch (e) {
      appendLog("ERROR", `Failed to publish to group ${groupName}: ${e}`);
      return { success: false, group_name: groupName, error: String(e) };
    }
  }

  async publishToGroups(
    groups: Record<string, unknown>[],
    text: string,
    imageUrls: string[],
    progressCallback?: (current: number, total: number, groupName: string, result: Record<string, unknown>) => void
  ) {
    const eligible = groups.filter(g => g.status === "ok");
    const total = eligible.length;
    let success = 0;
    let failed = 0;
    const results: Record<string, unknown>[] = [];

    for (let i = 0; i < eligible.length; i++) {
      const group = eligible[i];
      const groupId = Number(group.id);
      const groupName = (group.name || group.url || "unknown") as string;
      const result = await this.publishToGroup(groupId, groupName, text, imageUrls);
      results.push(result);

      if (result.success) success++;
      else failed++;

      if (progressCallback) {
        progressCallback(i + 1, total, groupName, result);
      }
      if (i < total - 1) await sleep(1000 + Math.random() * 2000);
    }
    return { success, failed, results };
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
