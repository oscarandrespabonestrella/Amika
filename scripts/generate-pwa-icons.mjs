// Generates the PWA icons from the Amika meeple (same path as src/components/brand.tsx).
// Run once with `npm run pwa:icons`; the PNGs in public/icons are committed.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const BG = "#0b0f14";
const FG = "#5ed3b5";
const MEEPLE = `<circle cx="50" cy="24" r="15"/><path d="M38 38C22 39 8 44 8 54c0 6 5 8 10 8h8L16 80c-4 7-1 14 7 14h15c4 0 6-2 8-5l4-7 4 7c2 3 4 5 8 5h15c8 0 11-7 7-14L74 62h8c5 0 10-2 10-8 0-10-14-15-30-16z"/>`;

/** `scale` = share of the canvas the meeple (100x100 box) occupies. */
function svg(size, scale) {
  const s = (size * scale) / 100;
  const offset = (size - size * scale) / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="${BG}"/>
      <g fill="${FG}" transform="translate(${offset} ${offset}) scale(${s})">${MEEPLE}</g>
    </svg>`,
  );
}

const outputs = [
  ["icon-192.png", 192, 0.7],
  ["icon-512.png", 512, 0.7],
  ["maskable-512.png", 512, 0.55], // inside the maskable safe zone
  ["apple-touch-icon.png", 180, 0.7],
];

await mkdir("public/icons", { recursive: true });
for (const [name, size, scale] of outputs) {
  await sharp(svg(size, scale)).png().toFile(`public/icons/${name}`);
  console.log("wrote public/icons/" + name);
}
