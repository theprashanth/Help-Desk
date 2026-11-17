/** @type {import('tailwindcss').Config} */

// Semantic color tokens are backed by CSS variables (see src/index.css) so the
// same class works in light and dark mode, e.g. `bg-surface`, `text-ink`.
const token = (name) => `rgb(var(--ic-${name}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../shared/src/**/*.{js,ts,jsx,tsx}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ---- Intercom-style semantic tokens ----
        canvas: token('canvas'),          // app background behind the panels
        surface: token('surface'),        // main white panels (chat, content)
        sidebar: token('sidebar'),        // off-white secondary panels (nav, list, details)
        subtle: token('subtle'),          // hover fills, round icon buttons, chips
        line: token('line'),              // borders and dividers
        ink: token('ink'),                // primary text, primary buttons
        muted: token('muted'),            // secondary text, labels
        faint: token('faint'),            // placeholders, timestamps, disabled
        accent: token('accent'),          // orange: active tab underline, toggles, add-links
        link: token('link'),              // blue text links
        'bubble-agent': token('bubble-agent'),
        'bubble-customer': token('bubble-customer'),
        note: token('note'),              // internal note background
        'note-line': token('note-line'),
        'on-ink': token('on-ink'),        // text placed on an ink (black) background

        // Legacy brand palette, kept so any untouched usage still renders.
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          950: '#2e1065',
        },
        panel: {
          light: '#ffffff',
          dark: '#111827',
          gray: '#f9fafb'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        panel: '16px',
      },
      boxShadow: {
        // white "selected pill" in nav lists
        pill: '0 1px 2px 0 rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.04)',
        // floating menus / popovers
        pop: '0 8px 28px -6px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        // raised cards (composer, selected list row)
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        glass: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
        'glass-dark': '0 8px 32px 0 rgba(0, 0, 0, 0.37)'
      },
      animation: {
        'slide-up': 'slideUp 0.2s ease-out',
        'slide-left': 'slideLeft 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out'
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        slideLeft: {
          '0%': { transform: 'translateX(8px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' }
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        }
      }
    },
  },
  plugins: [],
}
