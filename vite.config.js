import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0', // Listen on all IPv4 and IPv6 interfaces
    port: 5173,
    strictPort: false
  }
});
