/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        muted: "#748099",
        brand: "#5146e5",
        canvas: "#f5f7fb",
      },
      boxShadow: {
        soft: "0 14px 40px rgba(27, 38, 68, 0.07)",
      },
    },
  },
  plugins: [],
};
