/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // EVE Frontier dark theme
        surface: {
          0: '#0a0c10',
          1: '#111418',
          2: '#1a1f26',
          3: '#242b35',
        },
        accent: {
          DEFAULT: '#4a9eff',
          dim: '#2d6eb8',
        },
        allow: '#22c55e',
        deny: '#ef4444',
        default: '#6b7280',
      },
    },
  },
  plugins: [],
}
