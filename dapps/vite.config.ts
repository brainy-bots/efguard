import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// Auto-derive VITE_EVE_WORLD_PACKAGE_ID from VITE_TENANT at build time.
// This avoids the need to set it manually or mutate import.meta.env at runtime.
const TENANT_PACKAGE_IDS: Record<string, string> = {
  stillness: '0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c',
  utopia: '0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75',
  testevenet: '0x353988e063b4683580e3603dbe9e91fefd8f6a06263a646d43fd3a2f3ef6b8c1',
  nebula: '0x353988e063b4683580e3603dbe9e91fefd8f6a06263a646d43fd3a2f3ef6b8c1',
}

const tenant = process.env.VITE_TENANT || 'stillness'
const worldPkg = process.env.VITE_EVE_WORLD_PACKAGE_ID || TENANT_PACKAGE_IDS[tenant] || ''

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    // Inject as build-time env var so dapp-kit can read it
    'import.meta.env.VITE_EVE_WORLD_PACKAGE_ID': JSON.stringify(worldPkg),
  },
})
