import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.isroma.solycerveza',
  appName: 'Sol y Cerveza',
  // Vite's output. `base: './'` in vite.config.ts keeps asset paths relative, as Capacitor needs.
  webDir: 'dist',
}

export default config
