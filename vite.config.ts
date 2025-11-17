import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
// Dynamically set base for different hosts:
// - Cloudflare Pages (CF_PAGES=1): '/'
// - GitHub Pages: '/KillDoctorLuckyWeb/'
// - Override via env: VITE_BASE or BASE
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Default to '/' so Cloudflare Pages and local dev work out of the box.
  // Override via CLI: `vite build --base=/KillDoctorLuckyWeb/` (used in GH Pages workflow),
  // or via env: VITE_BASE/BASE.
  const base = env.VITE_BASE || env.BASE || '/'

  return {
    plugins: [react()],
    base,
  }
})
