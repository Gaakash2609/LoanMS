/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // EFIN brand colors — matches existing CSS theme exactly
      colors: {
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1a4fa3',  // EFIN primary blue
          900: '#1e3a5f',
        },
        efin: {
          blue:      '#1a4fa3',
          'blue-dark': '#1e3a5f',
          'blue-light': '#e8f0fe',
          green:     '#16a34a',
          orange:    '#ea580c',
          red:       '#dc2626',
          gray:      '#6b7280',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Outfit', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      },
    },
  },
  plugins: [],
}
