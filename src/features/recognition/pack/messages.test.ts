import { describe, expect, it } from "vitest";
import en from "../../../i18n/messages/en.json";
import es from "../../../i18n/messages/es.json";
import fr from "../../../i18n/messages/fr.json";

describe("the opt-in warning mentions the pack size before any download", () => {
  for (const [locale, messages] of Object.entries({ en, es, fr })) {
    it(`${locale}: the warning and the button carry the sizes`, () => {
      const a = messages.Recognition.live.activation;
      expect(a.warning).toContain("{mb}");
      expect(a.warning).toContain("{packMb}");
      expect(a.enable).toContain("{totalMb}");
    });
  }
});
