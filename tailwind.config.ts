import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted))",
        border: "hsl(var(--border))",
        card: "hsl(var(--card))",
        ring: "hsl(var(--ring))",
        accent: "hsl(var(--accent))"
      },
      boxShadow: {
        glass: "0 24px 55px -26px rgba(0, 0, 0, 0.6)",
        focus: "0 0 0 1px rgba(255,255,255,0.28), 0 0 0 4px rgba(255,255,255,0.08)"
      },
      backgroundImage: {
        grain:
          "radial-gradient(circle at 25% 15%, rgba(255,255,255,0.08), transparent 45%), radial-gradient(circle at 80% 0%, rgba(255,255,255,0.06), transparent 40%), linear-gradient(180deg, #1a1b1f 0%, #0f1012 100%)"
      },
      keyframes: {
        pulseSoft: {
          "0%": { opacity: "0.85", transform: "translateY(0)" },
          "50%": { opacity: "1", transform: "translateY(-2px)" },
          "100%": { opacity: "0.85", transform: "translateY(0)" }
        }
      },
      animation: {
        pulseSoft: "pulseSoft 2.4s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
