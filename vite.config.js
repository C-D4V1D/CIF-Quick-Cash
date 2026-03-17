import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'CIF Quick Cash',
        short_name: 'CIF Quick Cash',
        description: 'CIF Quick Cash Management App',
        theme_color: '#1a5f2a',
        icons: [
          {
            src: '/favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: '/favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          }
        ]
      }
    })
  ],
})
