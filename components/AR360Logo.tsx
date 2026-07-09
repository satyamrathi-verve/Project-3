/*
  The real exported logo (public/brand/ar360-logo.png) has solid black "AR"
  text with no dark-mode variant. `invert` + `hue-rotate-180` is the standard
  trick: it flips black to white (so "AR" stays legible on a dark background)
  while rotating the inverted orange back to roughly its original hue.

  Pass invertOnDark={false} when the logo sits on a card that stays light
  even in dark mode (e.g. the Sign In screen) — inverting there would turn
  "AR" white-on-white and make it unreadable.
*/
export function AR360Logo({
  className = "h-8",
  invertOnDark = true,
}: {
  className?: string;
  invertOnDark?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/ar360-logo.png"
      alt="AR360"
      className={`w-auto ${invertOnDark ? "dark:invert dark:hue-rotate-180" : ""} ${className}`}
    />
  );
}
