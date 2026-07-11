/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Brand colors (same hex as web for consistency)
        primary: "#6366f1",
        "primary-dark": "#4f46e5",
        success: "#22c55e",
        streak: "#f97316",
        // Dark theme defaults
        background: "#0a0a0f",
        card: "#111118",
        border: "#1e1e2a",
        foreground: "#f4f4f8",
        "muted-fg": "#6b6b80",
        muted: "#1e1e2a",
      },
      fontFamily: {
        sans: ["Inter", "System"],
        mono: ["JetBrainsMono", "Courier"],
      },
    },
  },
  plugins: [],
};
