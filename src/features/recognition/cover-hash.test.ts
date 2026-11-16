import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hamming } from "./dhash";
import {
  fetchCoverBytes,
  hashCoverBytes,
  isAllowedCoverUrl,
} from "./cover-hash";

const OK = "https://cf.geekdo-images.com/abc/pic123.jpg";

describe("isAllowedCoverUrl", () => {
  it("accepts https on the image hosts of BoardGameGeek (and their subdomains)", () => {
    expect(isAllowedCoverUrl(OK)).toBe(true);
    expect(isAllowedCoverUrl("https://cf.geekdo-static.com/x.png")).toBe(true);
    expect(isAllowedCoverUrl("https://images.geekdo-images.com/x.png")).toBe(
      true,
    );
  });

  it("rejects everything else", () => {
    for (const url of [
      "http://cf.geekdo-images.com/x.jpg",
      "https://example.com/x.jpg",
      "https://127.0.0.1/x.jpg",
      "https://[::1]/x.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://user:pw@cf.geekdo-images.com/x.jpg",
      "https://cf.geekdo-images.com.evil.com/x.jpg",
      "https://evilgeekdo-images.com/x.jpg",
      "https://cf.geekdo-images.com:8443/x.jpg",
      "ftp://cf.geekdo-images.com/x.jpg",
      "not a url",
      "",
    ])
      expect(isAllowedCoverUrl(url), url).toBe(false);
  });
});

const png = (bytes = 10) =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
const redirect = (to: string) =>
  new Response(null, { status: 302, headers: { location: to } });

describe("fetchCoverBytes", () => {
  it("returns the bytes of a normal image response", async () => {
    const fetchImpl = vi.fn(async () => png(10));
    const bytes = await fetchCoverBytes(OK, fetchImpl);
    expect(bytes).toHaveLength(10);
    // never follows redirects on its own
    expect(fetchImpl).toHaveBeenCalledWith(
      OK,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("follows up to two redirects, each re-validated against the allowlist", async () => {
    const hops = [
      redirect("https://cf.geekdo-images.com/b.jpg"),
      redirect("/c.jpg"),
      png(5),
    ];
    const fetchImpl = vi.fn(async () => hops.shift()!);
    expect(await fetchCoverBytes(OK, fetchImpl)).toHaveLength(5);
  });

  it("refuses a redirect to another host", async () => {
    const fetchImpl = vi.fn(async () => redirect("https://evil.example/x.png"));
    expect(await fetchCoverBytes(OK, fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a third redirect hop", async () => {
    const fetchImpl = vi.fn(async () =>
      redirect("https://cf.geekdo-images.com/next.jpg"),
    );
    expect(await fetchCoverBytes(OK, fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("refuses a URL outside the allowlist without any request", async () => {
    const fetchImpl = vi.fn(async () => png());
    expect(await fetchCoverBytes("https://example.com/x.png", fetchImpl)).toBe(
      null,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses non-image content, error statuses and network errors", async () => {
    expect(
      await fetchCoverBytes(
        OK,
        async () =>
          new Response("<html>", { headers: { "content-type": "text/html" } }),
      ),
    ).toBeNull();
    expect(
      await fetchCoverBytes(
        OK,
        async () =>
          new Response("nope", {
            status: 404,
            headers: { "content-type": "image/png" },
          }),
      ),
    ).toBeNull();
    expect(
      await fetchCoverBytes(OK, async () => {
        throw new Error("network down");
      }),
    ).toBeNull();
  });

  it("refuses SVG (it would be rasterized by a vector engine)", async () => {
    expect(
      await fetchCoverBytes(
        OK,
        async () =>
          new Response("<svg/>", {
            headers: { "content-type": "image/svg+xml" },
          }),
      ),
    ).toBeNull();
  });

  it("stops at the size cap instead of reading everything", async () => {
    expect(await fetchCoverBytes(OK, async () => png(3_000_000))).toBeNull();
    expect(await fetchCoverBytes(OK, async () => png(300), {})).toHaveLength(
      300,
    );
  });

  it("gives up after the timeout", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    expect(await fetchCoverBytes(OK, hang, { timeoutMs: 30 })).toBeNull();
  });
});

/** A deterministic, blocky, textured test picture (stable under JPEG and resizing). */
async function texturedPng(width = 360, height = 320) {
  const block = 40;
  const raw = Buffer.alloc(width * height * 3);
  let seed = 12345;
  const rand = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cols = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const tones = Array.from({ length: cols * rows }, () =>
    Math.floor(rand() * 255),
  );
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = tones[Math.floor(y / block) * cols + Math.floor(x / block)];
      const i = (y * width + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  return sharp(raw, { raw: { width, height, channels: 3 } });
}

describe("hashCoverBytes", () => {
  it("is deterministic and tells different pictures apart", async () => {
    const a = await (await texturedPng()).png().toBuffer();
    const gradient = await sharp(
      Buffer.from(Array.from({ length: 64 * 64 }, (_, i) => (i % 64) * 4)),
      { raw: { width: 64, height: 64, channels: 1 } },
    )
      .png()
      .toBuffer();
    const h1 = await hashCoverBytes(a);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(await hashCoverBytes(a)).toBe(h1);
    const h2 = await hashCoverBytes(gradient);
    expect(h2).not.toBe(h1);
  });

  it("the same picture re-encoded as JPEG and downscaled stays within distance 6", async () => {
    const base = await texturedPng();
    const original = await base.clone().png().toBuffer();
    const recompressed = await base
      .clone()
      .resize(180, 160)
      .jpeg({ quality: 70 })
      .toBuffer();
    const a = (await hashCoverBytes(original))!;
    const b = (await hashCoverBytes(recompressed))!;
    expect(hamming(a, b)).toBeLessThanOrEqual(6);
  });

  it("flattens transparency over white (it does not hash the hidden RGB)", async () => {
    // Left half fully transparent, right half opaque black: over white that is
    // white | black, which has bright-to-dark edges; hashed over black it would be flat.
    const width = 64;
    const height = 64;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        raw[i + 3] = x < width / 2 ? 0 : 255;
      }
    const transparent = await sharp(raw, {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();
    expect(await hashCoverBytes(transparent)).not.toBe("0000000000000000");
  });

  it("refuses to decode an image of more than 25 megapixels", async () => {
    // A solid 30 MP PNG is tiny on the wire (that is the point of the attack).
    const bomb = await sharp({
      create: { width: 6000, height: 5000, channels: 3, background: "#808080" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(await hashCoverBytes(bomb)).toBeNull();
  });

  it("is null for corrupt or empty bytes", async () => {
    expect(await hashCoverBytes(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(await hashCoverBytes(new Uint8Array())).toBeNull();
  });
});
