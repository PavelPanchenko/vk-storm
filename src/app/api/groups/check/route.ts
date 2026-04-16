import { NextResponse } from "next/server";
import { requireAccessToken } from "@/lib/api-auth";
import { readGroups, updateGroupPhoto, updateGroupMembersCount } from "@/lib/groups";
import { VKClient } from "@/lib/vk-client";

export async function POST() {
  const result = await requireAccessToken();
  if (result.error) return result.error;

  const groups = await readGroups();
  if (groups.length === 0) return NextResponse.json([]);

  const client = new VKClient(result.accessToken!);
  const results = await client.checkGroups(groups);

  for (const r of results) {
    const url = r.url as string;
    if (r.photo && url) {
      await updateGroupPhoto(url, r.photo as string);
    }
    if (r.members_count && url) {
      await updateGroupMembersCount(url, r.members_count as number);
    }
  }

  return NextResponse.json(results);
}
