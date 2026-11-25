import { describe, expect, it } from 'vitest'
import {
  adminRequestRefusal,
  latestOnly,
  type AdminRequest,
} from './adminGuard.ts'

const HOST = 'localhost:5173'

function post(headers: AdminRequest['headers'], method = 'POST'): AdminRequest {
  return { method, headers: { host: HOST, ...headers }, secure: false }
}

describe('adminRequestRefusal', () => {
  it('allows a same-origin JSON POST', () => {
    expect(
      adminRequestRefusal(
        post({
          'content-type': 'application/json',
          origin: `http://${HOST}`,
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toBeNull()
  })

  it('accepts a charset parameter on the content type', () => {
    expect(
      adminRequestRefusal(
        post({
          'content-type': 'Application/JSON; charset=utf-8',
          origin: `http://${HOST}`,
        }),
      ),
    ).toBeNull()
  })

  it('refuses a text/plain POST, even from the same origin', () => {
    expect(
      adminRequestRefusal(
        post({ 'content-type': 'text/plain', origin: `http://${HOST}` }),
      ),
    ).toMatch(/application\/json/)
  })

  it('refuses a POST with no content type', () => {
    expect(
      adminRequestRefusal(post({ origin: `http://${HOST}` })),
    ).not.toBeNull()
  })

  it('refuses a cross-origin Origin', () => {
    expect(
      adminRequestRefusal(
        post({
          'content-type': 'application/json',
          origin: 'https://evil.example',
        }),
      ),
    ).not.toBeNull()
  })

  it('refuses another localhost port and another scheme', () => {
    const json = { 'content-type': 'application/json' }
    expect(
      adminRequestRefusal(post({ ...json, origin: 'http://localhost:3000' })),
    ).not.toBeNull()
    expect(
      adminRequestRefusal(post({ ...json, origin: `https://${HOST}` })),
    ).not.toBeNull()
  })

  it('refuses Sec-Fetch-Site cross-site and same-site', () => {
    for (const site of ['cross-site', 'same-site'])
      expect(
        adminRequestRefusal(
          post({
            'content-type': 'application/json',
            origin: `http://${HOST}`,
            'sec-fetch-site': site,
          }),
        ),
      ).not.toBeNull()
  })

  it('refuses an Origin when the request has no Host', () => {
    expect(
      adminRequestRefusal({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: `http://${HOST}`,
        },
        secure: false,
      }),
    ).not.toBeNull()
  })

  it('allows a JSON request with no Origin (a non-browser client)', () => {
    expect(
      adminRequestRefusal(post({ 'content-type': 'application/json' })),
    ).toBeNull()
  })

  it('checks PUT and DELETE like POST', () => {
    for (const method of ['PUT', 'DELETE']) {
      expect(
        adminRequestRefusal(post({ origin: 'https://evil.example' }, method)),
      ).not.toBeNull()
      expect(
        adminRequestRefusal(
          post(
            { 'content-type': 'application/json', origin: `http://${HOST}` },
            method,
          ),
        ),
      ).toBeNull()
    }
  })

  it('refuses GET and HEAD from another site', () => {
    for (const method of ['GET', 'HEAD', undefined])
      for (const site of ['cross-site', 'Same-Site'])
        expect(
          adminRequestRefusal({
            method,
            headers: { host: HOST, 'sec-fetch-site': site },
            secure: false,
          }),
        ).not.toBeNull()
  })

  it('lets GET and HEAD through from the admin page, a typed URL or curl', () => {
    for (const method of ['GET', 'HEAD', undefined])
      for (const site of ['same-origin', 'none', undefined]) {
        const headers: AdminRequest['headers'] = { host: HOST }
        if (site !== undefined) headers['sec-fetch-site'] = site
        expect(
          adminRequestRefusal({ method, headers, secure: false }),
        ).toBeNull()
      }
  })

  it('needs no JSON content type or Origin check on GET', () => {
    expect(
      adminRequestRefusal({
        method: 'GET',
        headers: { host: HOST, 'content-type': 'text/plain' },
        secure: false,
      }),
    ).toBeNull()
  })

  it('compares with https when the dev server uses TLS', () => {
    expect(
      adminRequestRefusal({
        method: 'POST',
        headers: {
          host: HOST,
          'content-type': 'application/json',
          origin: `https://${HOST}`,
        },
        secure: true,
      }),
    ).toBeNull()
  })
})

describe('latestOnly', () => {
  it('aborts the running job when a new one starts', () => {
    const slot = latestOnly()
    const first = slot.start()
    const second = slot.start()
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })

  it('leaves nothing to abort once the current job finishes', () => {
    const slot = latestOnly()
    const first = slot.start()
    slot.finish(first)
    slot.start()
    expect(first.signal.aborted).toBe(false)
  })

  it('ignores a superseded job finishing late', () => {
    const slot = latestOnly()
    const first = slot.start()
    const second = slot.start()
    slot.finish(first)
    slot.start()
    expect(second.signal.aborted).toBe(true)
  })
})
