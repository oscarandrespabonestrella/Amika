import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/features/nights/guest/guest-service", () => ({
  getGuestState: vi.fn(),
  guestJoin: vi.fn(),
  guestToggleVote: vi.fn(),
  guestRename: vi.fn(),
  logGuestRequest: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import * as service from "@/features/nights/guest/guest-service";
import { GET, POST } from "@/app/api/nights/guest/[token]/route";

const TOKEN = "A".repeat(43);
const ctx = (token = TOKEN) => ({ params: Promise.resolve({ token }) });
const STATE = {
  night: { title: "T", startsOn: "2026-12-01", hostName: "H", status: "open" },
  games: [],
  guest: { name: "Ana" },
};
const GAME = "11111111-1111-4111-8111-111111111111";

function post(body: unknown, cookie?: string, token = TOKEN) {
  return POST(
    new NextRequest(`http://localhost/api/nights/guest/${token}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: cookie ? { cookie: `amika_guest=${cookie}` } : {},
    }),
    ctx(token),
  );
}

function joinKeyHashes() {
  return vi.mocked(service.guestJoin).mock.calls.map((c) => c[2]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(service.logGuestRequest).mockResolvedValue({
    lastMinute: 1,
    lastHour: 1,
  });
  vi.mocked(service.getGuestState).mockResolvedValue(STATE as never);
  vi.mocked(service.guestJoin).mockResolvedValue({ ok: true });
});

describe("guest route", () => {
  it("malformed token is 404 without db call", async () => {
    const res = await post({ action: "join", name: "Ana" }, undefined, "../x");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "link_invalid" });
    const get = await GET(
      new NextRequest("http://localhost/api/nights/guest/x"),
      ctx("x"),
    );
    expect(get.status).toBe(404);
    expect(service.getGuestState).not.toHaveBeenCalled();
    expect(service.logGuestRequest).not.toHaveBeenCalled();
  });

  it("join sets httpOnly cookie on /api/nights/guest", async () => {
    const res = await post({ action: "join", name: "Ana" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("amika_guest=");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toContain("Path=/api/nights/guest");
    expect(cookie).toContain("Expires=Thu, 03 Dec 2026 00:00:00 GMT");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("vote without cookie is 401", async () => {
    const res = await post({ action: "vote", nightGameId: GAME });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_guest" });
    expect(service.guestToggleVote).not.toHaveBeenCalled();
  });

  it("rejects votes after revoke", async () => {
    vi.mocked(service.logGuestRequest).mockResolvedValue({
      error: "link_invalid",
    });
    const res = await post({ action: "vote", nightGameId: GAME }, "k");
    expect(res.status).toBe(404);
    vi.mocked(service.logGuestRequest).mockResolvedValue({
      lastMinute: 1,
      lastHour: 1,
    });
    vi.mocked(service.guestToggleVote).mockResolvedValue({
      error: "link_invalid",
    });
    const again = await post({ action: "vote", nightGameId: GAME }, "k");
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "link_invalid" });
  });

  it("new browser is a new guest", async () => {
    await post({ action: "join", name: "Ana" });
    await post({ action: "join", name: "Ana" });
    const [a, b] = joinKeyHashes();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("a cookie renames the existing guest on join", async () => {
    await post({ action: "join", name: "Ana" }, "key-1");
    await post({ action: "join", name: "Bea" }, "key-1");
    const [a, b] = joinKeyHashes();
    expect(a).toBe(b);
  });

  it("over limit is 429 and does not write", async () => {
    vi.mocked(service.logGuestRequest).mockResolvedValue({
      lastMinute: 31,
      lastHour: 31,
    });
    const res = await post({ action: "vote", nightGameId: GAME }, "k");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(service.guestToggleVote).not.toHaveBeenCalled();
  });

  it("invalid body is 400", async () => {
    expect((await post({ action: "join", name: "  " })).status).toBe(400);
    expect((await post({ action: "vote", nightGameId: "x" }, "k")).status).toBe(
      400,
    );
    expect((await post({ action: "nope" })).status).toBe(400);
  });

  it("maps service errors", async () => {
    vi.mocked(service.guestJoin).mockResolvedValue({ error: "limit" });
    expect((await post({ action: "join", name: "Ana" })).status).toBe(409);
    vi.mocked(service.guestToggleVote).mockResolvedValue({
      error: "not_found",
    });
    expect(
      (await post({ action: "vote", nightGameId: GAME }, "k")).status,
    ).toBe(404);
    vi.mocked(service.guestRename).mockResolvedValue({ error: "closed" });
    expect((await post({ action: "rename", name: "B" }, "k")).status).toBe(409);
  });

  it("GET is no-store and hashes the cookie", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/nights/guest/${TOKEN}`, {
        headers: { cookie: "amika_guest=abc" },
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const [, keyHash] = vi.mocked(service.getGuestState).mock.calls[0];
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
