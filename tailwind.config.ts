import type { Config } from 'tailwindcss'
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#6d4aff', ink: '#26233b', muted: '#6e6a80',
        line: '#e9e6f1', canvas: '#f7f7fb', success: '#16784a', danger: '#c53c51'
      },
      fontFamily: { sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 3px 12px -5px rgb(44 29 83 / .13)' }
    }
  },
  plugins: []
} satisfies Config
