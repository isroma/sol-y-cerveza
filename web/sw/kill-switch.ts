// Kill switch: shipped as dist/sw.js instead of sw.ts when the build runs
// with VITE_SW_KILL_SWITCH=1 (repo variable SW_KILL_SWITCH, see README
// "Offline and the service worker"). Browsers check sw.js on every
// navigation, so this replaces the real worker on each user's next visit,
// even if the app's own code is broken. It takes over at once, deletes every
// cache this site made and unregisters itself. It answers no requests, so
// open pages go to the network from now on; nothing reloads under the user.

// A module only for type checking (the build strips this line).
export {}

declare const self: ServiceWorkerGlobalScope

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

async function clearCaches(): Promise<void> {
  const names = await caches.keys()
  await Promise.all(
    names
      .filter((name) => name.startsWith('syc-'))
      .map((name) => caches.delete(name)),
  )
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await clearCaches()
      await self.registration.unregister()
      // Once more, after anything the old worker was still storing when this
      // one took over.
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await clearCaches()
    })(),
  )
})
