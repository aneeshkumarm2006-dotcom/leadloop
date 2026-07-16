/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // LeadLoop landing pairing — Bricolage display + Familjen body.
        display: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
        heading: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
        body: ['Familjen Grotesk', 'system-ui', 'sans-serif'],
        mono: ['Space Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        accent: {
          DEFAULT: '#3E6B4E',
          hover: '#345C43',
          light: '#EEF3EA',
          text: '#3E6B4E',
        },
        base: '#F6F1E7',
        surface: '#FFFFFF',
        subtle: '#F1EADD',
        pine: {
          DEFAULT: '#1F3627',
          raise: '#29452F',
          active: '#35543E',
          text: '#EDE8DA',
          muted: '#A9BCA7',
          gold: '#D9B25F',
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(33,30,24,0.06), 0 0 0 1px #E4DCCB',
        soft: '0 4px 14px -4px rgba(33,30,24,0.12), 0 0 0 1px rgba(33,30,24,0.05)',
        pop: '0 12px 32px -8px rgba(33,30,24,0.20), 0 0 0 1px rgba(33,30,24,0.07)',
        accent: '0 4px 14px -3px rgba(62,107,78,0.40)',
      },
      borderRadius: {
        xl2: '20px',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(.22,.61,.36,1)',
      },
    },
  },
  plugins: [],
};
