import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  server: {
    // In dev, the game's WebSocket connects to /ws on the vite origin;
    // proxy it through to the node game server (npm start) on :3000.
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
