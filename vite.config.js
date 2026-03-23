import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'; // <-- THIS IS THE IMPORTANT LINE
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite'
import crossOriginIsolation from 'vite-plugin-cross-origin-isolation';





export default defineConfig({
  plugins: [nodePolyfills(), react(), tailwindcss(), crossOriginIsolation()],
  define: {
    global: 'window', // Sometimes needed for other polyfills
  },
    server: {
    headers:  {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
  }


});

