/*
  The real exported logo (public/brand/ar360-logo.png) has solid black "AR"
  text with no dark-mode variant. `invert` + `hue-rotate-180` is the standard
  trick: it flips black to white (so "AR" stays legible on dark backgrounds)
  while rotating the inverted orange back to roughly its original hue.
*/
export function AR360Logo({ className = "h-8" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/ar360-logo.png"
      alt="AR360"
      className={`w-auto dark:invert dark:hue-rotate-180 ${className}`}
    />
  );
}
