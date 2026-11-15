import { describe, expect, it } from "vitest";
import { parseYoutubeId, youtubeEmbedUrl } from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("parseYoutubeId", () => {
  it.each([
    ["a bare id", ID],
    ["a bare id with spaces", `  ${ID}  `],
    ["watch", `https://www.youtube.com/watch?v=${ID}`],
    ["watch without www", `https://youtube.com/watch?v=${ID}`],
    [
      "watch with extra params",
      `https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`,
    ],
    ["mobile", `https://m.youtube.com/watch?v=${ID}`],
    ["short link", `https://youtu.be/${ID}`],
    ["short link with params", `https://youtu.be/${ID}?si=abc&t=10`],
    ["embed", `https://www.youtube.com/embed/${ID}`],
    ["nocookie embed", `https://www.youtube-nocookie.com/embed/${ID}`],
    ["shorts", `https://www.youtube.com/shorts/${ID}`],
    ["live", `https://www.youtube.com/live/${ID}`],
    ["old /v/ form", `https://www.youtube.com/v/${ID}`],
    ["http", `http://www.youtube.com/watch?v=${ID}`],
  ])("accepts %s", (_label, input) => {
    expect(parseYoutubeId(input)).toBe(ID);
  });

  it("accepts ids containing - and _", () => {
    expect(parseYoutubeId("a-b_c-d_e-f")).toBe("a-b_c-d_e-f");
    expect(parseYoutubeId("https://youtu.be/a-b_c-d_e-f")).toBe("a-b_c-d_e-f");
  });

  it.each([
    ["another host", `https://evil.com/watch?v=${ID}`],
    ["a lookalike host", `https://www.youtube.com.evil.com/watch?v=${ID}`],
    ["a lookalike suffix", `https://notyoutube.com/watch?v=${ID}`],
    ["a subdomain trick", `https://youtube.com@evil.com/watch?v=${ID}`],
    ["javascript:", `javascript:alert(1)//youtube.com/watch?v=${ID}`],
    ["data:", `data:text/html,youtube.com/watch?v=${ID}`],
    ["ftp", `ftp://www.youtube.com/watch?v=${ID}`],
    [
      "a playlist without a video",
      "https://www.youtube.com/playlist?list=PL1234567890A",
    ],
    ["the channel page", "https://www.youtube.com/@someone"],
    ["a too short id", "https://www.youtube.com/watch?v=abc"],
    ["a too long id", `https://www.youtube.com/watch?v=${ID}extra`],
    ["an id with markup", "https://www.youtube.com/watch?v=<script>aa"],
    ["a bare invalid id", "not-an-id!!"],
    ["an empty string", ""],
    [
      "a path with the id in the wrong place",
      `https://www.youtube.com/channel/${ID}`,
    ],
  ])("rejects %s", (_label, input) => {
    expect(parseYoutubeId(input)).toBeNull();
  });
});

describe("youtubeEmbedUrl", () => {
  it("builds the privacy-friendly embed URL", () => {
    expect(youtubeEmbedUrl(ID)).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}?rel=0&autoplay=1`,
    );
  });

  it("refuses an invalid id instead of building an arbitrary URL", () => {
    expect(() => youtubeEmbedUrl("x/../y")).toThrow();
    expect(() => youtubeEmbedUrl('abc"onload="x')).toThrow();
  });
});
