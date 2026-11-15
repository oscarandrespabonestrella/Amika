import { describe, expect, it } from "vitest";
import {
  faqInputSchema,
  faqReviewSchema,
  imageInputSchema,
  resourceInputSchema,
  rulesSummarySchema,
} from "./schemas";

const GAME = "00000000-0000-4000-8000-0000000000d1";
const YT = "dQw4w9WgXcQ";
const codes = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  (result.error?.issues ?? []).map((i) => `${String(i.path[0])}:${i.message}`);

describe("resourceInputSchema", () => {
  const rules = {
    gameId: GAME,
    kind: "rules",
    locale: "en",
    title: "Official rules",
    target: "https://example.com/rules.pdf",
  };

  it("turns a rules link into a URL resource, 'any' into a null locale", () => {
    expect(resourceInputSchema.parse(rules)).toEqual({
      gameId: GAME,
      kind: "rules",
      locale: "en",
      title: "Official rules",
      url: "https://example.com/rules.pdf",
      youtubeId: null,
      isOfficial: false,
    });
    expect(
      resourceInputSchema.parse({ ...rules, locale: "any" }).locale,
    ).toBeNull();
  });

  it.each([
    `https://www.youtube.com/watch?v=${YT}`,
    `https://youtu.be/${YT}`,
    YT,
  ])("stores only the YouTube id for a video (%s)", (target) => {
    const parsed = resourceInputSchema.parse({
      ...rules,
      kind: "video",
      target,
      isOfficial: true,
    });
    expect(parsed).toMatchObject({
      kind: "video",
      url: null,
      youtubeId: YT,
      isOfficial: true,
    });
  });

  it.each([
    [
      "a non-YouTube video link",
      { kind: "video", target: "https://vimeo.com/123" },
      "target:invalidVideo",
    ],
    [
      "a video that is just any https URL",
      { kind: "video", target: "https://example.com/v.mp4" },
      "target:invalidVideo",
    ],
    ["http", { target: "http://example.com/r.pdf" }, "target:invalidUrl"],
    ["javascript:", { target: "javascript:alert(1)" }, "target:invalidUrl"],
    [
      "data:",
      { target: "data:text/html,<script>1</script>" },
      "target:invalidUrl",
    ],
    [
      "credentials in the URL",
      { target: "https://user:pass@example.com/r" },
      "target:invalidUrl",
    ],
    ["not a URL", { target: "just some text" }, "target:invalidUrl"],
    ["an empty title", { title: "  " }, "title:required"],
    ["a title over 200", { title: "x".repeat(201) }, "title:tooLong"],
    [
      "a URL over 500",
      { target: `https://example.com/${"a".repeat(500)}` },
      "target:tooLong",
    ],
  ])("rejects %s", (_label, change, expected) => {
    const result = resourceInputSchema.safeParse({ ...rules, ...change });
    expect(result.success).toBe(false);
    expect(codes(result)).toContain(expected);
  });

  it("rejects an unsupported language, an unknown kind and extra keys", () => {
    expect(
      resourceInputSchema.safeParse({ ...rules, locale: "de" }).success,
    ).toBe(false);
    expect(
      resourceInputSchema.safeParse({ ...rules, kind: "pdf" }).success,
    ).toBe(false);
    expect(
      resourceInputSchema.safeParse({ ...rules, created_by: "someone" })
        .success,
    ).toBe(false);
  });
});

describe("rulesSummarySchema, imageInputSchema, faqInputSchema", () => {
  it("accepts valid input and trims", () => {
    expect(
      rulesSummarySchema.parse({
        gameId: GAME,
        locale: "es",
        body: "  Resumen  ",
      }).body,
    ).toBe("Resumen");
    expect(
      imageInputSchema.parse({
        gameId: GAME,
        url: "https://e.com/a.jpg",
        attribution: " Foto: X ",
      }).attribution,
    ).toBe("Foto: X");
    expect(
      faqInputSchema.parse({
        gameId: GAME,
        locale: "fr",
        question: " Q ",
        answer: " A ",
      }),
    ).toMatchObject({ question: "Q", answer: "A" });
  });

  it("requires an attribution for gallery images and an https URL", () => {
    expect(
      codes(
        imageInputSchema.safeParse({
          gameId: GAME,
          url: "https://e.com/a.jpg",
          attribution: "",
        }),
      ),
    ).toContain("attribution:required");
    expect(
      codes(
        imageInputSchema.safeParse({
          gameId: GAME,
          url: "http://e.com/a.jpg",
          attribution: "x",
        }),
      ),
    ).toContain("url:invalidUrl");
  });

  it("enforces the length limits", () => {
    expect(
      rulesSummarySchema.safeParse({
        gameId: GAME,
        locale: "en",
        body: "x".repeat(20_001),
      }).success,
    ).toBe(false);
    expect(
      rulesSummarySchema.safeParse({
        gameId: GAME,
        locale: "en",
        body: "x".repeat(20_000),
      }).success,
    ).toBe(true);
    expect(
      codes(
        faqInputSchema.safeParse({
          gameId: GAME,
          locale: "en",
          question: "x".repeat(301),
          answer: "a",
        }),
      ),
    ).toContain("question:tooLong");
    expect(
      codes(
        faqInputSchema.safeParse({
          gameId: GAME,
          locale: "en",
          question: "q",
          answer: "x".repeat(3001),
        }),
      ),
    ).toContain("answer:tooLong");
    expect(
      codes(
        faqInputSchema.safeParse({
          gameId: GAME,
          locale: "en",
          question: "",
          answer: "a",
        }),
      ),
    ).toContain("question:required");
  });

  it("rejects unsupported languages and unknown keys (no mass assignment)", () => {
    expect(
      faqInputSchema.safeParse({
        gameId: GAME,
        locale: "de",
        question: "q",
        answer: "a",
      }).success,
    ).toBe(false);
    expect(
      faqInputSchema.safeParse({
        gameId: GAME,
        locale: "en",
        question: "q",
        answer: "a",
        status: "published",
      }).success,
    ).toBe(false);
  });
});

describe("faqReviewSchema", () => {
  it("accepts approve and reject only", () => {
    expect(
      faqReviewSchema.safeParse({ faqId: GAME, decision: "approve" }).success,
    ).toBe(true);
    expect(
      faqReviewSchema.safeParse({ faqId: GAME, decision: "reject" }).success,
    ).toBe(true);
    expect(
      faqReviewSchema.safeParse({ faqId: GAME, decision: "publish" }).success,
    ).toBe(false);
    expect(
      faqReviewSchema.safeParse({ faqId: "nope", decision: "approve" }).success,
    ).toBe(false);
  });
});
