import { colorForIndex } from "@/lib/colors";

/*
  Renders text with each character colored from the shared categorical palette —
  the same Rainbow-CSV-style effect used for Upload Report's column tinting,
  applied to labels instead of columns. Spaces stay uncolored.
*/
export function RainbowText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split("").map((ch, i) =>
        ch === " " ? (
          <span key={i}>{" "}</span>
        ) : (
          <span key={i} style={{ color: colorForIndex(i) }}>
            {ch}
          </span>
        )
      )}
    </span>
  );
}
