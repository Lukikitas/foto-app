import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Necesario para GitHub Pages: https://lukikitas.github.io/foto-app/
  base: '/foto-app/',
  plugins: [react()],
})
