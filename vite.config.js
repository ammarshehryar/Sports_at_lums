import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// GitHub Pages project sites are served from https://<user>.github.io/<repo>/,
// which used to need the exact repo name baked in as the base path (fragile -
// a rename, a case mismatch, or a fork under a different name would silently
// 404 every asset and render a blank page). There's no client-side router
// here, so a relative base ("./") works everywhere instead: every asset
// resolves relative to wherever index.html itself is served from, whether
// that's localhost, a GitHub Pages project subpath, or a custom domain.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    chunkSizeWarningLimit: 800,
  },
})
