import { describe, expect, it } from 'vitest'
import {
  serviceWorkerAction,
  type ServiceWorkerContext,
} from './registerServiceWorker.ts'

const site: ServiceWorkerContext = {
  dev: false,
  killSwitch: false,
  native: false,
  supported: true,
  pathname: '/sol-y-cerveza/',
}

describe('serviceWorkerAction', () => {
  it('registers on the built site', () => {
    expect(serviceWorkerAction(site)).toBe('register')
    expect(
      serviceWorkerAction({ ...site, pathname: '/sol-y-cerveza/index.html' }),
    ).toBe('register')
  })

  it('stays off in dev, in Capacitor, in the admin and without support', () => {
    expect(serviceWorkerAction({ ...site, dev: true })).toBe('none')
    expect(serviceWorkerAction({ ...site, native: true })).toBe('none')
    expect(serviceWorkerAction({ ...site, supported: false })).toBe('none')
    expect(serviceWorkerAction({ ...site, pathname: '/admin.html' })).toBe(
      'none',
    )
  })

  it('removes the worker in a kill-switch build', () => {
    expect(serviceWorkerAction({ ...site, killSwitch: true })).toBe(
      'unregister',
    )
    expect(serviceWorkerAction({ ...site, killSwitch: true, dev: true })).toBe(
      'none',
    )
  })
})
