import "server-only";

type Context = Record<string, string | number | boolean | null | undefined>;

/**
 * Minimal server logger. It records a message, the error class/code and
 * non-sensitive context: never pass emails, tokens or request bodies, and the
 * error *message* is deliberately not logged (it may echo user data).
 */
export const logger = {
  error(message: string, error?: unknown, context: Context = {}) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : undefined;
    const errorName = error instanceof Error ? error.name : undefined;
    console.error(
      JSON.stringify({ level: "error", message, errorName, code, ...context }),
    );
  },
};
