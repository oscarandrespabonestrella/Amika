// Test support: the 95 modules of an EAN-13 barcode (1 = bar, 0 = space). Used to draw
// synthetic barcode pictures in the E2E suite and in the recognition self-test.

const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const G = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
const R = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

export function ean13Modules(code: string): string {
  const d = [...code].map(Number);
  const parity = PARITY[d[0]];
  let out = "101";
  for (let i = 0; i < 6; i++) out += (parity[i] === "L" ? L : G)[d[i + 1]];
  out += "01010";
  for (let i = 0; i < 6; i++) out += R[d[i + 7]];
  return out + "101";
}
