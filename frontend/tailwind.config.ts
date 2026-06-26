import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design System: BreadCo Production Console
        // Deep navy blue + white palette
        blue: {
          950: '#01102B',
          900: '#051D4D',
          700: '#0B2E70',
          600: '#103B8C',
          500: '#1E4FAD',
          100: '#DEE7F9',
          50: '#EEF2FA',
        },
        // Neutral palette
        white: '#FFFFFF',
        ink: '#0E1B33',
        slate: {
          600: '#48597A',
          400: '#8C9AB8',
        },
        border: '#DCE6F7',
        // Status colors
        success: '#0F9D58',
        successBg: '#E6F7EE',
        warning: '#C97A0E',
        warningBg: '#FCF1DF',
        danger: '#D6394A',
        dangerBg: '#FCE9EB',
      },
      fontFamily: {
        // Design System Typography
        display: ['Space Grotesk', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      fontSize: {
        // Updated Typography Scale (overriding design system for better readability)
        pageTitle: ['28px', { fontWeight: '700', lineHeight: '1.2' }],
        panelTitle: ['18px', { fontWeight: '700', lineHeight: '1.3' }],
        panelSubtitle: ['14px', { fontWeight: '400', lineHeight: '1.4' }],
        kpiValue: ['36px', { fontWeight: '600', letterSpacing: '-0.01em' }],
        kpiLabel: ['14px', { fontWeight: '500', lineHeight: '1.4' }],
        kpiDelta: ['14px', { fontWeight: '600', lineHeight: '1.3' }],
        navItem: ['16px', { fontWeight: '500', lineHeight: '1.4' }],
        tableHeader: ['13px', { fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }],
        tableCell: ['15px', { fontWeight: '400', lineHeight: '1.4' }],
        monoData: ['14px', { fontWeight: '600', lineHeight: '1.4' }],
        pillLabel: ['13px', { fontWeight: '600', lineHeight: '1.3' }],
        caption: ['12px', { fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.12em' }],
      },
      borderRadius: {
        DEFAULT: '9px',
        pill: '20px',
        avatar: '50%',
      },
      boxShadow: {
        card: '0 1px 3px rgba(11,60,140,0.05)',
      },
      spacing: {
        sidebar: '320px',
      },
    },
  },
  plugins: [],
};

export default config;