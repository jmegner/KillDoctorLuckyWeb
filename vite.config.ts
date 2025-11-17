import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
// Use the repo name as the base path for GitHub Pages deployments
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Ensure built asset URLs work at https://<user>.github.io/KillDoctorLuckyWeb/
  base: mode === 'production' ? '/KillDoctorLuckyWeb/' : '/',
}))
