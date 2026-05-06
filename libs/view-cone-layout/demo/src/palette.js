/**
 * Shared layer/slot palette.
 *
 * Same 5 vivid hexes used in /Users/armand/Documents/music-vids
 * (web/src/proxy-scene.js, web/src/timeline.js): no purple, green, cyan,
 * teal, or washed-out steel-blue. Cycle through indices for stable colors.
 */
// All high-saturation high-value. No red / amber / blue. No black (additive
// Spectacles display turns black into transparent — see
// ~/.claude/skills/lens-studio/references/spectacles-ui.md).
export const PALETTE = [
  '#ff3080', // hot pink
  '#ff10c0', // hot fuchsia
  '#ffe000', // vivid yellow
  '#ffa030', // vivid orange
];

export function colorForIndex(i) {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

export function colorForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function hexToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}
