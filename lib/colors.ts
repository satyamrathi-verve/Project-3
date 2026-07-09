/*
  Shared categorical palette (CVD-safe, fixed order) used anywhere the app wants a
  Rainbow-CSV-style, one-hue-per-item effect — the Upload Report preview's
  per-column tinting and the Nav sidebar's rainbow labels both cycle through this
  same set, so the two don't drift into different color languages.

  Unlike a chart mark (which only needs ~3:1 against its surface because an
  adjacent label carries the meaning), these hues ARE the text here, so every
  slot was picked to individually clear 4.5:1 against white and validated as a
  set with the dataviz skill's palette validator (lightness band, chroma floor,
  CVD adjacent-pair separation) before being locked in.
*/
export const CATEGORICAL_COLORS = [
  "#2563eb", // blue
  "#dc2626", // red
  "#047857", // emerald
  "#db2777", // pink
  "#7c3aed", // violet
  "#b45309", // amber
  "#4f46e5", // indigo
  "#4d7c0f", // lime
];

export function colorForIndex(index: number): string {
  return CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length];
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
