import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Friend = {
  userId: string;
  displayName: string;
  avatarPath: string | null;
};

export type FriendError = "invalid" | "own" | "limit";

const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;

/** Only name and avatar of my friends: the database function exposes nothing else. */
export async function listFriends(): Promise<Friend[]> {
  const { data, error } =
    await createSupabaseServerClient().rpc("list_friends");
  if (error) throw error;
  return (data ?? []).map((f) => ({
    userId: f.user_id,
    displayName: f.display_name,
    avatarPath: f.avatar_path,
  }));
}

export async function createFriendInvite(): Promise<
  { code: string } | { error: "limit" }
> {
  const { data, error } = await createSupabaseServerClient().rpc(
    "create_friend_invite",
  );
  if (pgCode(error) === "FR004") return { error: "limit" };
  if (error) throw error;
  return { code: data };
}

export async function revokeFriendInvite(code: string): Promise<void> {
  const { error } = await createSupabaseServerClient().rpc(
    "revoke_friend_invite",
    { p_code: code },
  );
  if (error) throw error;
}

/** FR001 bad/used/expired/revoked link, FR005 your own link, FR003 friends limit. */
export async function redeemFriendInvite(
  code: string,
): Promise<{ friendId: string } | { error: FriendError }> {
  const { data, error } = await createSupabaseServerClient().rpc(
    "redeem_friend_invite",
    { p_code: code },
  );
  const c = pgCode(error);
  if (c === "FR001") return { error: "invalid" };
  if (c === "FR005") return { error: "own" };
  if (c === "FR003") return { error: "limit" };
  if (error) throw error;
  return { friendId: data };
}

export async function removeFriend(friendId: string): Promise<void> {
  const { error } = await createSupabaseServerClient().rpc("remove_friend", {
    p_friend: friendId,
  });
  if (error) throw error;
}
