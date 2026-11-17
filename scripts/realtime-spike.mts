/**
 * Phase 8a spike: does Supabase Realtime deliver postgres_changes through the Clerk token
 * AND respect RLS? User A listens to `plays`; A's own insert must arrive, B's must not.
 *   node --conditions=react-server --import tsx scripts/realtime-spike.mts
 */
import { existsSync } from "node:fs";
import { createClerkClient } from "@clerk/backend";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function userClient(email: string) {
  const { data } = await clerk.users.getUserList({ emailAddress: [email] });
  const user = data[0];
  if (!user) throw new Error(`no test user ${email}; run the e2e setup once`);
  const session = await clerk.sessions.createSession({ userId: user.id });
  const token = (await clerk.sessions.getToken(session.id, "")).jwt;
  return {
    id: user.id,
    db: createClient(url, key, { accessToken: async () => token }),
    token,
  };
}

const a = await userClient("bglib-e2e-a+clerk_test@example.com");
const b = await userClient("bglib-e2e-b+clerk_test@example.com");
const { data: game } = await admin
  .from("games").select("id").is("owner_id", null).limit(1).single();

const seen: string[] = [];
a.db.realtime.setAuth(a.token);
const channel = a.db
  .channel("spike")
  .on("postgres_changes", { event: "*", schema: "public", table: "plays" },
    (p) => seen.push(`${p.eventType}:${(p.new as { created_by?: string })?.created_by ?? (p.old as { id?: string })?.id}`))
  .subscribe();
await sleep(3000);

const insert = async (u: typeof a) =>
  (await u.db.from("plays").insert({ game_id: game!.id }).select("id").single()).data!.id;
const pa = await insert(a);
const pb = await insert(b);
await sleep(3000);
await a.db.from("plays").delete().eq("id", pa);
await sleep(3000);
await b.db.from("plays").delete().eq("id", pb);
await channel.unsubscribe();

const own = seen.filter((s) => s.startsWith("INSERT") && s.endsWith(a.id)).length;
const foreign = seen.filter((s) => s.includes(b.id)).length;
const del = seen.some((s) => s.startsWith("DELETE"));
console.log("events:", seen);
console.log(own === 1 ? "PASS a (own insert arrives)" : "FAIL a");
console.log(foreign === 0 ? "PASS b (foreign insert does not)" : "FAIL b");
console.log(del ? "PASS c (own delete arrives)" : "FAIL c");
process.exit(own === 1 && foreign === 0 && del ? 0 : 1);
