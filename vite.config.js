import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

function copyTesseractAssets() {
  const destRoot = path.join(root, 'public', 'tesseract')
  const coreDest = path.join(destRoot, 'core')
  const langDest = path.join(destRoot, 'lang')
  fs.mkdirSync(coreDest, { recursive: true })
  fs.mkdirSync(langDest, { recursive: true })

  fs.copyFileSync(
    path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'),
    path.join(destRoot, 'worker.min.js'),
  )

  const coreDir = path.join(root, 'node_modules/tesseract.js-core')
  for (const file of fs.readdirSync(coreDir)) {
    if (file.includes('lstm') && file.endsWith('.wasm.js')) {
      fs.copyFileSync(path.join(coreDir, file), path.join(coreDest, file))
    }
  }

  fs.copyFileSync(
    path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
    path.join(langDest, 'eng.traineddata.gz'),
  )
  fs.copyFileSync(
    path.join(root, 'node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz'),
    path.join(langDest, 'spa.traineddata.gz'),
  )
}

function tesseractAssets() {
  return {
    name: 'tesseract-assets',
    buildStart() {
      copyTesseractAssets()
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Dominio propio de GitHub Pages: https://delivery.star-app.com.ar/
  base: '/',
  plugins: [
    react(),
    tesseractAssets(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['pwa-192.png', 'pwa-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Delivery La Plata',
        short_name: 'Delivery',
        description: 'Registro de fotos y archivos de delivery',
        theme_color: '#E4002B',
        background_color: '#E4002B',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm,gz}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/tesseract\//],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
})
