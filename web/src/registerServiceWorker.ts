// Registers the offline service worker (sw/sw.ts, built as dist/sw.js).

declare global {
  interface Window {
    /** Set by the Capacitor runtime (@capacitor/core and the native bridge). */
    Capacitor?: { isNativePlatform?: () => boolean }
  }
}

export type ServiceWorkerContext = {
  /** Vite dev server (`npm run dev`, `npm run admin`). */
  dev: boolean
  /** Built with VITE_SW_KILL_SWITCH=1: remove the worker instead. */
  killSwitch: boolean
  /** Inside the Capacitor iOS or Android shell. */
  native: boolean
  /** The browser has service workers (secure context). */
  supported: boolean
  /** The page's path. */
  pathname: string
}

export type ServiceWorkerAction = 'register' | 'unregister' | 'none'

/** What to do with the service worker on this page. */
export function serviceWorkerAction(
  context: ServiceWorkerContext,
): ServiceWorkerAction {
  if (!context.supported || context.dev || context.native) return 'none'
  // The admin is dev only, but never let it own a worker.
  if (context.pathname.endsWith('/admin.html')) return 'none'
  return context.killSwitch ? 'unregister' : 'register'
}

/**
 * After the page has loaded, registers ./sw.js for the app's own directory,
 * so it works under /sol-y-cerveza/ on GitHub Pages and at / in a preview.
 * A new worker takes over silently: the page is never reloaded under the
 * user, and the next load gets the new version.
 */
export function registerServiceWorker(): void {
  const action = serviceWorkerAction({
    dev: import.meta.env.DEV,
    killSwitch: import.meta.env.VITE_SW_KILL_SWITCH === '1',
    native: window.Capacitor?.isNativePlatform?.() === true,
    supported: 'serviceWorker' in navigator && window.isSecureContext,
    pathname: window.location.pathname,
  })
  if (action === 'none') return
  window.addEventListener('load', () => {
    const { serviceWorker } = navigator
    const done =
      action === 'register'
        ? serviceWorker
            .register('./sw.js', { scope: './', updateViaCache: 'none' })
            .then(() => undefined)
        : removeServiceWorker(serviceWorker)
    done.catch((error: unknown) => {
      // Offline caching is an extra: the app works without it.
      console.warn('Service worker:', error)
    })
  })
}

/**
 * Kill switch, page side. A registered worker is updated to the kill switch
 * (sw/kill-switch.ts, this build's sw.js): it takes over from the old one,
 * so nothing writes to the caches any more, then clears them and
 * unregisters. Unregistering from here instead would leave the old worker
 * controlling this page, and caching, until it closes. Without a worker,
 * only leftover caches remain to delete.
 */
async function removeServiceWorker(
  serviceWorker: ServiceWorkerContainer,
): Promise<void> {
  const registrations = await serviceWorker.getRegistrations()
  if (registrations.length > 0) {
    await Promise.all(registrations.map((r) => r.update()))
    return
  }
  const names = await caches.keys()
  await Promise.all(
    names
      .filter((name) => name.startsWith('syc-'))
      .map((name) => caches.delete(name)),
  )
}
