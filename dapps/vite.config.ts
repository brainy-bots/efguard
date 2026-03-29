import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  // Hash-based routing for in-game browser compatibility
  base: './',
})
