/** @type {import('tailwindcss').Config} */
import PrimeUI from 'tailwindcss-primeui';

export default {
    darkMode: ['selector', '[class*="app-dark"]'],
    content: ['./src/**/*.{html,ts}'],
    plugins: [PrimeUI],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Archivo', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
                mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
            }
        }
    }
};
