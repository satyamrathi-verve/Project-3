/*
  The real exported logo (public/brand/ar360-logo.png) has solid black "AR"
  text baked in, with no color variant of its own. `invert` + `hue-rotate-180`
  is the standard trick: it flips black to white (so "AR" stays legible on a
  dark background) while rotating the inverted orange back to roughly its
  original hue.

  invert:
  - "never"  — card stays light regardless of theme (e.g. Sign In screen);
               inverting there would turn "AR" white-on-white.
  - "dark"   — only invert when the app's dark mode is on (default).
  - "always" — invert unconditionally, e.g. sitting on a fixed-blue sidebar
               that never itself goes "light."
*/
export function AR360Logo({
  className = "h-8",
  invert = "dark",
}: {
  className?: string;
  invert?: "never" | "dark" | "always";
}) {
  const invertClass =
    invert === "always" ? "invert hue-rotate-180" : invert === "dark" ? "dark:invert dark:hue-rotate-180" : "";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/ar360-logo.png" alt="AR360" className={`w-auto ${invertClass} ${className}`} />
  );
}
