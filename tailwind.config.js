/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens exatos da Fase 5 — design system consolidado
        'bg-base': '#0B0D0F',
        'bg-card': '#12151A',
        'border-default': '#23262B',
        'border-subtle': '#1D2026',
        'text-primary': '#F2F3F5',
        'text-secondary': '#8A8F98',
        'text-muted': '#5B6069',
        'income-green': '#97C459',
        'income-green-alt': '#5DCAA5',
        'expense-red': '#F09595',
        'warning-amber': '#EF9F27',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
