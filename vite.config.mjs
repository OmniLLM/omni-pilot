import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Vite owns the Tailwind compilation while the extension's JavaScript keeps
// its purpose-built concat pipeline in build.mjs. This preserves the globals
// used by the extension test harness without giving up Tailwind's supported
// Vite integration.
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    cssMinify: true,
    rollupOptions: {
      input: 'src/styles/tailwind.css',
      output: {
        assetFileNames: assetInfo =>
          assetInfo.name?.endsWith('.css') ? 'tailwind.css' : 'assets/[name]-[hash][extname]'
      }
    }
  }
});
