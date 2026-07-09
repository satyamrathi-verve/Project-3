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
          // Verve Advisory's official navy (sampled from the real logo) —
          // primary blue accent across the whole app.
          DEFAULT: "#23408b",
          dark: "#182d63",
        },
        accent: {
          // Secondary orange accent, paired with the brand blue on white.
          DEFAULT: "#f2994a",
          dark: "#c2660a",
        },
        chrome: {
          // Blue used for the sidebar/header "chrome" and the Sign In
          // backdrop — a deep royal navy, used as a subtle ombre gradient
          // rather than a flat near-black navy.
          light: "#22316e",
          DEFAULT: "#182252",
          dark: "#0e1638",
        },
        cream: {
          // Warm off-white replacing plain white across page canvases and
          // cards — pairs better with the navy chrome than stark white.
          DEFAULT: "#fefcf6",
          dim: "#f8f3e6",
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
