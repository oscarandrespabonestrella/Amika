// Test-only: a deterministic synthetic "box cover" and a Y4M video of it, so Chromium's
// fake camera (--use-file-for-fake-video-capture) can look at a known picture.
import { writeFileSync } from "node:fs";

export const PIC_W = 640;
export const PIC_H = 480;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RGB pixels of a corner-rich synthetic picture (many rectangles and dots): ORB loves it. */
export function syntheticCover(seed: number): Buffer {
  const rand = mulberry32(seed);
  const rgb = Buffer.alloc(PIC_W * PIC_H * 3);
  const base = [
    Math.floor(rand() * 255),
    Math.floor(rand() * 255),
    Math.floor(rand() * 255),
  ];
  for (let i = 0; i < PIC_W * PIC_H; i++) {
    rgb[i * 3] = base[0];
    rgb[i * 3 + 1] = base[1];
    rgb[i * 3 + 2] = base[2];
  }
  const rect = (x: number, y: number, w: number, h: number, c: number[]) => {
    for (let yy = Math.max(0, y); yy < Math.min(PIC_H, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(PIC_W, x + w); xx++) {
        const o = (yy * PIC_W + xx) * 3;
        rgb[o] = c[0];
        rgb[o + 1] = c[1];
        rgb[o + 2] = c[2];
      }
  };
  for (let i = 0; i < 90; i++)
    rect(
      Math.floor(rand() * PIC_W),
      Math.floor(rand() * PIC_H),
      12 + Math.floor(rand() * 110),
      12 + Math.floor(rand() * 90),
      [
        Math.floor(rand() * 255),
        Math.floor(rand() * 255),
        Math.floor(rand() * 255),
      ],
    );
  for (let i = 0; i < 260; i++)
    rect(
      Math.floor(rand() * PIC_W),
      Math.floor(rand() * PIC_H),
      3 + Math.floor(rand() * 6),
      3 + Math.floor(rand() * 6),
      [
        Math.floor(rand() * 255),
        Math.floor(rand() * 255),
        Math.floor(rand() * 255),
      ],
    );
  return rgb;
}

/** Writes `frames` identical frames of `rgb` as a Y4M (4:2:0) file. */
export function writeY4m(path: string, rgb: Buffer, frames = 20, fps = 10) {
  const y = Buffer.alloc(PIC_W * PIC_H);
  const cw = PIC_W / 2;
  const ch = PIC_H / 2;
  const u = Buffer.alloc(cw * ch);
  const v = Buffer.alloc(cw * ch);
  for (let j = 0; j < PIC_H; j++)
    for (let i = 0; i < PIC_W; i++) {
      const o = (j * PIC_W + i) * 3;
      const [r, g, b] = [rgb[o], rgb[o + 1], rgb[o + 2]];
      y[j * PIC_W + i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      const o = (j * 2 * PIC_W + i * 2) * 3;
      const [r, g, b] = [rgb[o], rgb[o + 1], rgb[o + 2]];
      u[j * cw + i] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
      v[j * cw + i] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
    }
  const header = Buffer.from(
    `YUV4MPEG2 W${PIC_W} H${PIC_H} F${fps}:1 Ip A1:1 C420jpeg\n`,
  );
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, u, v]);
  writeFileSync(
    path,
    Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]),
  );
}
