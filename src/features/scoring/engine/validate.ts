import {
  type Category,
  type Definition,
  definitionSchema,
  SCORE_LIMITS,
} from "./definition";

export type DefinitionIssue = {
  code:
    | "shape"
    | "duplicateKey"
    | "unknownRef"
    | "cycle"
    | "duplicateOption"
    | "duplicateTableValue"
    | "duplicateInput"
    | "noScoringCategory"
    | "tooLarge";
  categoryKey?: string;
  /** For `shape` issues: where (e.g. "categories.2.label")... */
  path?: string;
  /** ...and the stable Zod message code (required, tooLong, outOfRange, ...). */
  message?: string;
};

export type ValidationResult =
  | { ok: true; definition: Definition }
  | { ok: false; issues: DefinitionIssue[] };

const MAX_SHAPE_ISSUES = 20;

function byteLength(input: unknown): number | null {
  try {
    const json = JSON.stringify(input);
    return json === undefined ? 0 : new TextEncoder().encode(json).length;
  } catch {
    return null; // circular or otherwise not serializable
  }
}

const hasDuplicates = (values: readonly (string | number)[]) =>
  new Set(values).size !== values.length;

function semanticIssues(categories: readonly Category[]): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const keys = categories.map((c) => c.key);

  for (const key of new Set(keys.filter((k, i) => keys.indexOf(k) !== i)))
    issues.push({ code: "duplicateKey", categoryKey: key });

  if (!categories.some((c) => c.scoring))
    issues.push({ code: "noScoringCategory" });

  const known = new Set(keys);
  const refsOf = new Map<string, readonly string[]>();
  for (const c of categories) {
    if (c.type === "choice" && hasDuplicates(c.options.map((o) => o.key)))
      issues.push({ code: "duplicateOption", categoryKey: c.key });
    if (c.type === "table" && hasDuplicates(c.rows.map((r) => r.value)))
      issues.push({ code: "duplicateTableValue", categoryKey: c.key });
    if (c.type === "set_bonus" && hasDuplicates(c.inputs.map((i) => i.key)))
      issues.push({ code: "duplicateInput", categoryKey: c.key });
    if (c.type === "derived") {
      refsOf.set(c.key, c.refs);
      if (c.refs.some((r) => !known.has(r)))
        issues.push({ code: "unknownRef", categoryKey: c.key });
    }
  }

  if (!issues.some((i) => i.code === "unknownRef")) {
    const cyclic = findCycle(refsOf);
    if (cyclic) issues.push({ code: "cycle", categoryKey: cyclic });
  }
  return issues;
}

/** Returns a key on a cycle among derived categories, or null. Iterative DFS. */
function findCycle(refsOf: Map<string, readonly string[]>): string | null {
  const state = new Map<string, "visiting" | "done">();
  for (const start of refsOf.keys()) {
    if (state.get(start) === "done") continue;
    const stack: { key: string; next: number }[] = [{ key: start, next: 0 }];
    state.set(start, "visiting");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const refs = refsOf.get(frame.key) ?? [];
      if (frame.next >= refs.length) {
        state.set(frame.key, "done");
        stack.pop();
        continue;
      }
      const ref = refs[frame.next++];
      if (!refsOf.has(ref)) continue; // not derived: a leaf
      const seen = state.get(ref);
      if (seen === "visiting") return ref;
      if (seen === undefined) {
        state.set(ref, "visiting");
        stack.push({ key: ref, next: 0 });
      }
    }
  }
  return null;
}

/** Never throws, whatever it is given: stored definitions are untrusted. */
export function validateDefinition(input: unknown): ValidationResult {
  const size = byteLength(input);
  if (size === null) return { ok: false, issues: [{ code: "shape" }] };
  if (size > SCORE_LIMITS.maxDefinitionBytes)
    return { ok: false, issues: [{ code: "tooLarge" }] };

  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, MAX_SHAPE_ISSUES).map((issue) => ({
        code: "shape" as const,
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const issues = semanticIssues(parsed.data.categories);
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, definition: parsed.data };
}
