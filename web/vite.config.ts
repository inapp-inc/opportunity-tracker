import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const basePath = process.env.VITE_BASE_PATH || '/'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  base: basePath,
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/auth': { target: 'http://localhost:3001', changeOrigin: true },
      '/records': { target: 'http://localhost:3001', changeOrigin: true },
      '/opportunities': { target: 'http://localhost:3001', changeOrigin: true },
      '/notifications': { target: 'http://localhost:3001', changeOrigin: true },
      '/reports': { target: 'http://localhost:3001', changeOrigin: true },
      '/settings': { target: 'http://localhost:3001', changeOrigin: true },
      '/catalog': { target: 'http://localhost:3001', changeOrigin: true },
      '/users': { target: 'http://localhost:3001', changeOrigin: true },
      '/platform': { target: 'http://localhost:3001', changeOrigin: true },
      '/tenants': { target: 'http://localhost:3001', changeOrigin: true },
      '/export': { target: 'http://localhost:3001', changeOrigin: true },
      '/prospect-groups': { target: 'http://localhost:3001', changeOrigin: true },
      '/analytics': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
