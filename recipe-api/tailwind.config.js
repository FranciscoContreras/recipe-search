/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.{html,js}",
    "node_modules/preline/dist/*.js"
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1a4432',
        tertiary: '#266549',
        secondary: '#2b7156',
        accent: '#f55b2b',
        surface: '#e0e0d2',
        background: '#fafafa',
        // Legacy support mapping
        deep: {
          900: '#1a4432',
          800: '#266549',
        }
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        display: ['Grenda', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [
    require('preline/plugin'),
  ],
}