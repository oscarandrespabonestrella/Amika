import { describe, expect, it } from "vitest";
import { toLiveError } from "./error-codes";

describe("toLiveError", () => {
  it("conserva los códigos conocidos y convierte el resto en failed", () => {
    expect(toLiveError("closed")).toBe("closed");
    expect(toLiveError("custom_game")).toBe("custom_game");
    expect(toLiveError("whatever")).toBe("failed");
  });
});
