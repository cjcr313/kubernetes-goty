import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: {
          950: '#09090b',
          900: '#0f0f12',
          800: '#18181b',
          700: '#27272a',
        },
      },
    },
  },
  plugins: [],
};

export default config;
