/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        surface: "var(--bg-primary)",
        "surface-2": "var(--bg-secondary)",
        "surface-3": "var(--bg-tertiary)",
        "text-1": "var(--text-primary)",
        "text-2": "var(--text-secondary)",
        "text-3": "var(--text-tertiary)",
      },
    },
  },
  plugins: [],
};
