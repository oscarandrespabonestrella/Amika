// Geometry of the wheel. Angles are degrees, clockwise, 0 = the pointer at the top.
// Slice i spans [i·a, (i+1)·a) of the wheel's own frame, a = 360 / n.

const mod360 = (deg: number) => ((deg % 360) + 360) % 360;

/**
 * The next cumulative rotation that stops slice `index` under the pointer after
 * `turns` extra full turns. `offset` (0..1) is where inside the slice it lands, kept
 * away from the edges so the result is never ambiguous.
 */
export function targetRotation(
  current: number,
  index: number,
  count: number,
  turns: number,
  offset: number,
): number {
  const slice = 360 / count;
  const inside = slice * (0.1 + 0.8 * offset);
  const wanted = mod360(-(index * slice + inside));
  return current + turns * 360 + mod360(wanted - mod360(current));
}

/** The slice under the pointer at a given cumulative rotation. */
export function sliceAtPointer(rotation: number, count: number): number {
  return Math.floor(mod360(-rotation) / (360 / count)) % count;
}

/** SVG path of slice `index` of a wheel of radius `r` centred on (r, r). */
export function slicePath(index: number, count: number, r: number): string {
  if (count === 1) {
    return `M ${r} 0 A ${r} ${r} 0 1 1 ${r} ${2 * r} A ${r} ${r} 0 1 1 ${r} 0 Z`;
  }
  const a = (2 * Math.PI) / count;
  const point = (angle: number) =>
    `${(r + r * Math.sin(angle)).toFixed(3)} ${(r - r * Math.cos(angle)).toFixed(3)}`;
  const large = a > Math.PI ? 1 : 0;
  return `M ${r} ${r} L ${point(index * a)} A ${r} ${r} 0 ${large} 1 ${point((index + 1) * a)} Z`;
}
