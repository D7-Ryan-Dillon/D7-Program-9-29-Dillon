import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Studio theme: black canvas + one pink accent, matching the
        // Section Field / 3D Object Study tools this app pairs with.
        ink: "#050505",
        panel: "#0c0c0c",
        line: "#262626",
        accent: {
          DEFAULT: "#ff2f92",
          dim: "#7a1749",
        },
        void: "#ff2f92",
        foam: "#f5f5f2",
        muted: "#8a8a8a",
      },
      fontFamily: {
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      letterSpacing: {
        widest2: "0.18em",
      },
    },
  },
  plugins: [],
};

export default config;
