/*
  Shared categorical palette (CVD-safe, fixed order) used anywhere the app wants a
  Rainbow-CSV-style, one-hue-per-item effect — the Upload Report preview's
  per-column tinting and the Nav sidebar's rainbow labels both cycle through this
  same set, so the two don't drift into different color languages.
*/
export const CATEGORICAL_COLORS = [
  "#2a78d6",
  "#1baf7a",
  "#eda100",
  "#008300",
  "#4a3aa7",
  "#e34948",
  "#e87ba4",
  "#eb6834",
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
