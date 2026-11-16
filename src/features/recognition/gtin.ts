// Pure: no imports. Check digits of EAN-8 / UPC-A / EAN-13 (the GS1 modulo-10 rule).

/** Digits only, valid check digit, normalized to 13 digits; null otherwise. */
export function parseGtin(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  if (![8, 12, 13].includes(digits.length)) return null;

  // From the right, skipping the check digit: weights 3, 1, 3, 1, …
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight)
    sum += Number(digits[i]) * weight;
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(digits[digits.length - 1])) return null;

  return digits.padStart(13, "0");
}
