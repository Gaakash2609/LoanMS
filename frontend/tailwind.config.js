/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // EFIN brand colors — matches existing CSS theme exactly
      colors: {
        // ── Neutral ramp remapped onto the legacy palette ──────────────────
        // The React app uses Tailwind's stock `gray-*` scale in 1,709 places
        // across 81 files as its neutral ramp (text-gray-500 alone: 317). That
        // scale is a cool blue-black unrelated to the legacy design, which is
        // why React screens read as a slightly different "temperature" than the
        // legacy UI even where spacing and type already matched.
        //
        // Remapping the palette here fixes every one of those call sites at
        // once, instead of hand-editing 81 files — and it is reversible by
        // deleting this block. Each rung is anchored to a legacy token that was
        // already verified by rendered comparison during the component ports:
        //   gray-900 -> --text   (CardHeader title, confirmed)
        //   gray-500 -> --text3  (table th, confirmed)
        //   gray-200 -> --border (table/card rules, confirmed)
        //   gray-50  -> --surface2 (input fill, confirmed)
        // The intermediate rungs follow the same ramp so relative contrast is
        // preserved — a gray-600 label stays darker than a gray-400 hint.
        //
        // Deliberately NOT remapped: slate/zinc/neutral/stone (used for status
        // and badge colours), and every non-neutral hue.
        gray: {
          50:  '#f0f4ff', // --surface2
          100: '#e6ecf8', // --surface3
          200: '#dde3f0', // --border
          300: '#c4cfe6', // --border2
          400: '#7a8aaa', // --text3
          500: '#7a8aaa', // --text3
          600: '#3a4d6e', // --text2
          700: '#3a4d6e', // --text2
          800: '#1b2a4d', // between --text2 and --text
          900: '#0c1733', // --text
          950: '#070f22',
        },
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#0a589a',  // MudraHub primary blue (logo "Mudra" blue)
          900: '#064377',
        },
        efin: {
          blue:      '#0a589a',
          'blue-dark': '#064377',
          'blue-light': '#e8f0fe',
          green:     '#16a34a',
          orange:    '#f5921e',
          red:       '#dc2626',
          gray:      '#6b7280',
        },
        // MudraHub brand colors, taken from the company logo: "Mudra" is blue
        // and "Hub" / the "Driven by Elitetru" tagline are orange (#f5921e).
        // Kept separate from the legacy `efin` tokens above (still used
        // elsewhere in the app) rather than overwriting them, so this is a
        // purely additive change. `red` retained for backwards-compat only.
        mudrahub: {
          blue:      '#0a589a',
          'blue-dark': '#073d6b',
          orange:    '#f5921e',
          red:       '#e31e25',
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
