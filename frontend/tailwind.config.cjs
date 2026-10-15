/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        onepay: {
          50: '#f6f3ff',
          100: '#eee8ff',
          500: '#7c52f4',
          600: '#6b3ee9',
          700: '#572ecb',
          900: '#271a48',
        },
      },
      boxShadow: {
        card: '0 14px 42px rgba(37, 25, 74, 0.055)',
      },
    },
  },
  plugins: [],
};
