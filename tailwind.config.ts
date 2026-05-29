import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sapthagiri: {
          burgundy: "#6B1C2C",
          gold: "#C9A452",
          cream: "#FAF6EE",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      boxShadow: {
        // Burgundy-tinted elevation instead of flat black, to match the brand.
        card: "0 1px 2px rgba(107,28,44,0.06), 0 6px 16px -8px rgba(107,28,44,0.18)",
      },
    },
  },
  plugins: [],
};
export default config;
