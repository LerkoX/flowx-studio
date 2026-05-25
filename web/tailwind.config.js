/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          indigo: '#6366f1',
          purple: '#a855f7',
        },
        status: {
          running: '#22d3ee',
          success: '#34d399',
          error: '#fb7185',
          idle: '#94a3b8',
        },
      },
      fontFamily: {
        mono: ['SF Mono', 'Monaco', 'Cascadia Code', 'monospace'],
      },
      animation: {
        'flow-dash': 'flowDash 1s linear infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'rotate': 'rotate 3s linear infinite',
      },
      keyframes: {
        flowDash: {
          to: { strokeDashoffset: '-15' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(99, 102, 241, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(99, 102, 241, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        rotate: {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
      },
      backdropBlur: {
        '2xl': '24px',
      },
    },
  },
  plugins: [],
}
