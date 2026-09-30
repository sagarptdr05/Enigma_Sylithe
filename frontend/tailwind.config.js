/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F5F6F4", surface: "#FFFFFF", border: "#E3E6E3", ink: "#122126", muted: "#5B676C", subtle: "#F0F2EF",
        brand: { DEFAULT: "#0E2F36", light: "#16414A", dark: "#0A242A" },
        emerald: { DEFAULT: "#15803D", soft: "#E8F5EC" }, amber: { DEFAULT: "#B45309", soft: "#FEF4E6" },
        sky: { DEFAULT: "#0369A1", soft: "#E8F2F8" }, danger: { DEFAULT: "#B91C1C", soft: "#FDECEC" },
      },
      fontFamily: {
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        brand: ['"Space Grotesk"', "Inter", "sans-serif"],
      },
      boxShadow: {
        glow: "0 1px 2px rgba(16,24,40,.05)",
        soft: "0 1px 2px rgba(16,24,40,.04)",
        pop: "0 8px 24px -8px rgba(16,24,40,.18)",
      },
      fontSize: { "2xs": ["10.5px", "14px"] },
    },
  },
  plugins: [],
};
