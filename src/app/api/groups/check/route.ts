import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readGroups, updateGroupPhoto, updateGroupMembersCount } from "@/lib/groups";
import { checkGroups } from "@/lib/vk-discovery";

export async function POST() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const groups = await readGroups(auth.session.user_id);
  if (groups.length === 0) return NextResponse.json([]);

  const results = await checkGroups(auth.sessionId, auth.session, groups);

  for (const r of results) {
    if (r.status !== "ok" || !r.url) continue;
    if (r.photo) await updateGroupPhoto(auth.session.user_id, r.url, r.photo);
    if (r.members_count) await updateGroupMembersCount(auth.session.user_id, r.url, r.members_count);
  }

  return NextResponse.json(results);
}
