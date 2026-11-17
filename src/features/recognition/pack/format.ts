// Pure. The binary layout of the reference pack's vectors file: `count` consecutive
// little-endian Float32 vectors of EMBED_DIM numbers, each L2-normalized. No header: the
// manifest holds the count.
import { EMBED_DIM } from "../embedding/thresholds";

export class PackFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackFormatError";
  }
}

const NORM_TOLERANCE = 1e-3;

export function encodePack(vecs: Float32Array[]): Uint8Array {
  const all = new Float32Array(vecs.length * EMBED_DIM);
  vecs.forEach((v, i) => {
    if (v.length !== EMBED_DIM)
      throw new PackFormatError(`vector ${i} has ${v.length} numbers`);
    all.set(v, i * EMBED_DIM);
  });
  return new Uint8Array(all.buffer, all.byteOffset, all.byteLength);
}

/** Throws PackFormatError on a wrong size, a non-finite number or a vector that is not unit length. */
export function decodePack(bytes: Uint8Array, count: number): Float32Array[] {
  if (bytes.byteLength !== count * EMBED_DIM * 4)
    throw new PackFormatError(
      `expected ${count * EMBED_DIM * 4} bytes, got ${bytes.byteLength}`,
    );
  // Copy: the view may not be 4-byte aligned.
  const all = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const v = all.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM);
    let sum = 0;
    for (const x of v) {
      if (!Number.isFinite(x))
        throw new PackFormatError(`vector ${i} has a non-finite number`);
      sum += x * x;
    }
    if (Math.abs(Math.sqrt(sum) - 1) > NORM_TOLERANCE)
      throw new PackFormatError(`vector ${i} is not unit length`);
    out.push(v);
  }
  return out;
}
