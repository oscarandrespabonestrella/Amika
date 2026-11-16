// Pure: no imports. A 64-bit difference hash (dHash) of a 9x8 grayscale thumbnail.
// Written as 16 lowercase hex characters everywhere (never a JSON number: precision).

export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;

const HEX16 = /^[0-9a-f]{16}$/;

export function isHash(s: string): boolean {
  return HEX16.test(s);
}

/**
 * `gray` is exactly 9x8 luminance values, row-major. A bit is set when a pixel is
 * brighter than its right-hand neighbour (so brightness shifts and contrast scaling do
 * not change the hash). Bits are written most significant first, row by row.
 */
export function dHashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== HASH_WIDTH * HASH_HEIGHT)
    throw new Error(`expected ${HASH_WIDTH * HASH_HEIGHT} values`);
  let bits = BigInt(0);
  for (let y = 0; y < HASH_HEIGHT; y++) {
    for (let x = 0; x < HASH_WIDTH - 1; x++) {
      const i = y * HASH_WIDTH + x;
      bits = (bits << BigInt(1)) | BigInt(gray[i] > gray[i + 1] ? 1 : 0);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

/** Number of differing bits between two hashes (0–64). Throws on malformed input. */
export function hamming(a: string, b: string): number {
  if (!isHash(a) || !isHash(b)) throw new Error("malformed hash");
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  while (x > BigInt(0)) {
    count += Number(x & BigInt(1));
    x >>= BigInt(1);
  }
  return count;
}
