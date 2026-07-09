import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          // Verve Advisory's official navy (sampled from the real logo), not a
          // generic blue — keeps every bg-brand/text-brand accent on-brand.
          DEFAULT: "#23408b",
          dark: "#182d63",
        },
        accent: {
          DEFAULT: "#f2994a",
          dark: "#c2660a",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "IBM Plex Sans",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
