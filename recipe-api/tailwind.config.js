/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.{html,js}",
    "node_modules/preline/dist/*.js"
  ],
  theme: {
    extend: {
      colors: {
        // Defining "Deep" colors based on your request
        deep: {
          900: '#1e1b4b', // Deep Indigo
          800: '#312e81',
        }
      }
    },
  },
  plugins: [
    require('preline/plugin'),
  ],
}