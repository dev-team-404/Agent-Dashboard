/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        samsung: {
          blue: '#2563EB',
          'blue-dark': '#1D4ED8',
          'blue-light': '#3B82F6',
          dark: '#111827',
          gray: '#6B7280',
          'gray-light': '#F9FAFB',
        },
        // Neutral gray scale — no blue tint
        pastel: {
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          secondary: '#F9FAFB',
          tertiary: '#F3F4F6',
          hover: '#F9FAFB',
        },
        accent: {
          blue: '#2563EB',
          indigo: '#4F46E5',
          violet: '#7C3AED',
          emerald: '#059669',
          amber: '#D97706',
          rose: '#E11D48',
        },
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          'Apple SD Gothic Neo',
          'Malgun Gothic',
          'Noto Sans KR',
          'Segoe UI',
          'sans-serif',
        ],
      },
      boxShadow: {
        'soft': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-hover': '0 4px 12px -2px rgb(0 0 0 / 0.08)',
        'elevated': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        'glass': '0 4px 12px rgb(0 0 0 / 0.06)',
        'modal': '0 20px 40px -8px rgb(0 0 0 / 0.15)',
        'glow-blue': '0 0 12px rgb(37 99 235 / 0.12)',
        'glow-indigo': '0 0 12px rgb(79 70 229 / 0.12)',
        'inner-light': 'inset 0 1px 0 0 rgb(255 255 255 / 0.05)',
        'ios': '0 1px 3px rgb(0 0 0 / 0.06)',
        'ios-lg': '0 4px 12px rgb(0 0 0 / 0.08)',
        'depth': '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
      },
      borderRadius: {
        'ios': '8px',
        'ios-lg': '10px',
        'ios-xl': '12px',
        '4xl': '2rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'shimmer': 'shimmer 1.4s ease-in-out infinite',
        'count-up': 'countUp 0.5s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'gradient': 'gradient 8s ease infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'stagger-1': 'slideUp 0.4s ease-out 0.05s both',
        'stagger-2': 'slideUp 0.4s ease-out 0.1s both',
        'stagger-3': 'slideUp 0.4s ease-out 0.15s both',
        'stagger-4': 'slideUp 0.4s ease-out 0.2s both',
        'stagger-5': 'slideUp 0.4s ease-out 0.25s both',
        'stagger-6': 'slideUp 0.4s ease-out 0.3s both',
        'bounce-gentle': 'bounceGentle 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        countUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        glow: {
          '0%': { boxShadow: '0 0 12px rgb(37 99 235 / 0.1)' },
          '100%': { boxShadow: '0 0 20px rgb(37 99 235 / 0.18)' },
        },
        bounceGentle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      backdropBlur: {
        'ios': '20px',
        'xl': '24px',
      },
      transitionTimingFunction: {
        'ios': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'ios-spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'mesh-1': 'radial-gradient(at 40% 20%, rgb(37 99 235 / 0.06) 0px, transparent 50%), radial-gradient(at 80% 0%, rgb(79 70 229 / 0.04) 0px, transparent 50%)',
        'mesh-2': 'radial-gradient(at 0% 0%, rgb(37 99 235 / 0.04) 0px, transparent 50%), radial-gradient(at 100% 100%, rgb(79 70 229 / 0.03) 0px, transparent 50%)',
      },
    },
  },
  plugins: [],
};
