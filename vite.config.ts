import { defineConfig } from 'vite'

// Relative base so the built assets resolve at any GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) without hard-coding the repo name.
export default defineConfig({
  base: './',
  server: { port: 5180 },
  build: { target: 'es2020' },
})
