import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

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

  const tesseractDir = path.dirname(require.resolve('tesseract.js'))
  const coreDir = path.dirname(require.resolve('tesseract.js-core', { paths: [tesseractDir] }))
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

function cameraDemoDownload() {
  const apk = path.join(root, 'output/demo/Delivery-Star-Camara-DEMO.apk')
  const route = '/demo/camara/Delivery-Star-Camara-DEMO.apk'
  return {
    name: 'camera-demo-download',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== route) return next()
        if (!fs.existsSync(apk)) { response.statusCode = 404; response.end('Primero compilá el APK demo.'); return }
        response.setHeader('Content-Type', 'application/vnd.android.package-archive')
        response.setHeader('Content-Disposition', 'attachment; filename="Delivery-Star-Camara-DEMO.apk"')
        response.setHeader('Content-Length', fs.statSync(apk).size)
        if (request.method === 'HEAD') { response.end(); return }
        fs.createReadStream(apk).pipe(response)
      })
    },
    writeBundle(options) {
      const folder = path.resolve(options.dir, 'demo/camara')
      fs.mkdirSync(folder, { recursive: true })
      fs.copyFileSync(apk, path.join(folder, 'Delivery-Star-Camara-DEMO.apk'))
      fs.copyFileSync(path.join(root, 'src/demo/sw.js'), path.resolve(options.dir, 'sw.js'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Dominio propio de GitHub Pages: https://delivery.star-app.com.ar/
  base: '/',
  cacheDir: mode === 'demo' ? 'node_modules/.vite-demo' : 'node_modules/.vite',
  resolve: mode === 'demo' ? { alias: [{
    find: /^(?:\.\.?\/)+(?:lib\/)?supabase(?:\.js)?$/,
    replacement: path.join(root, 'src/demo/client.js'),
  }, {
    find: /^(?:\.\.?\/)+(?:components\/)?UpdatePrompt(?:\.jsx)?$/,
    replacement: path.join(root, 'src/demo/DisabledUpdatePrompt.jsx'),
  }] } : undefined,
  // Android/QA reports are not application entrypoints.
  optimizeDeps: { entries: ['index.html'] },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    rolldownOptions: {
      output: { codeSplitting: { groups: [
        { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
        { name: 'vendor-supabase', test: /node_modules[\\/](@supabase|@opentelemetry)[\\/]/ },
      ] } },
    },
  },
  plugins: [
    react(),
    ...(mode === 'demo' ? [cameraDemoDownload()] : []),
    tesseractAssets(),
    ...(mode === 'demo' ? [] : [VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['pwa-192.png', 'pwa-512.png', 'apple-touch-icon.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,woff2,wasm,gz}'],
        globIgnores: ['**/node_modules/**', '**/presentacion/**', '**/manual/**', '**/tesseract/**',
          '**/Metrics*.js', '**/Complaints*.js', '**/Complaint*.js', '**/Settings*.js', '**/DailyPending*.js',
          '**/*Workbook*.js', '**/*Refunds*.js', '**/*Ocr*.js', '**/ocr*.js'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        rollupFormat: 'iife',
      },
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
    })]),
  ],
}))
