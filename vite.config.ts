import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
// Dynamically set base for different hosts:
// - Cloudflare Pages (CF_PAGES=1): '/'
// - GitHub Pages: '/KillDoctorLuckyWeb/'
// - Override via env: VITE_BASE or BASE
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Force '/' when running on Cloudflare Pages so assets are requested from the root
  // rather than a repo subpath. Cloudflare exposes CF_PAGES=1 during build, so even if
  // VITE_BASE/BASE are set for GitHub Pages builds, we fall back to '/' here to avoid
  // MIME/type errors from 404 asset requests.
  const base = env.CF_PAGES === '1' ? '/' : env.VITE_BASE || env.BASE || '/'

  return {
    plugins: [react()],
    base,
  }
})
