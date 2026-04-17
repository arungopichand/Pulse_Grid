import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          950: "#060816",
          900: "#0a1020",
          800: "#111a31",
          700: "#1a2745",
        },
        accent: {
          cyan: "#4cf5ff",
          blue: "#5b8cff",
          green: "#6effb1",
          amber: "#f3c969",
          red: "#ff6b8a",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(91,140,255,0.12), 0 20px 60px rgba(8,12,28,0.6)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(91,140,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(91,140,255,0.08) 1px, transparent 1px)",
      },
      keyframes: {
        pulseIn: {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        pulseIn: "pulseIn 350ms ease-out",
        shimmer: "shimmer 3.5s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
