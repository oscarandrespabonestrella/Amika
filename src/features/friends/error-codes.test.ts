import { describe, expect, it } from "vitest";
import { toFriendError } from "./error-codes";

describe("toFriendError", () => {
  it("conserva los códigos conocidos y convierte el resto en failed", () => {
    expect(toFriendError("own")).toBe("own");
    expect(toFriendError("not_friend")).toBe("not_friend");
    expect(toFriendError("boom")).toBe("failed");
  });
});
