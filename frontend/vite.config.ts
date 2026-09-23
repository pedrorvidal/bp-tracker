import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Must match BP_TRACKER_FRONTEND_ORIGIN on the backend, or CORS blocks
    // every request. Fail loudly instead of silently picking another port.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    // A non-UTC zone with a fixed offset (-03:00, no DST), so date handling
    // is exercised with a real offset and results are deterministic.
    env: { TZ: 'America/Sao_Paulo' },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
