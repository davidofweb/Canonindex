import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env': {},
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        'next/link': path.resolve(__dirname, 'src/shims/next-link.tsx'),
        'next/navigation': path.resolve(__dirname, 'src/shims/next-navigation.ts'),
      },
    },
    server: {
      // HMR is disabled when DISABLE_HMR is set to true.
      // File watching is managed via DISABLE_HMR to keep resources light.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
