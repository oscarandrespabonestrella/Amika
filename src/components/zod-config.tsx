"use client";

import { z } from "zod";

// Zod 4 probes `new Function` to decide whether it may compile faster parsers. Under a
// strict Content-Security-Policy that probe is caught, but the browser still REPORTS it
// as a violation. In the browser the speed-up is irrelevant, so turn the JIT off (the
// server keeps its default). Runs when this module is evaluated, before any parsing.
z.config({ jitless: true });

export function ZodConfig() {
  return null;
}
