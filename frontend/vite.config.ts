import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Keep Vite on its localhost-only default; do not add server.host without security review.
export default defineConfig({
  plugins: [react()],
})
