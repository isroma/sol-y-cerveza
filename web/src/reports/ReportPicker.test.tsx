import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import type { Picking } from './picking.ts'
import { ReportPicker } from './ReportPicker.tsx'

// The API and the bot check as a build with both configured has them.
vi.mock('../apiClient.ts', async (original) => {
  vi.stubEnv('VITE_PRICES_API', 'https://api.test')
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
  return original()
})

vi.mock('./Turnstile.tsx', () => ({
  Turnstile: ({ onToken }: { onToken: (token: string) => void }) => {
    useEffect(() => onToken('token'), [onToken])
    return null
  },
}))

const venue: Terrace = {
  id: 'osm:node/1',
  name: 'Bar Uno',
  kind: 'bar',
  venue: { lat: 38.878, lon: -6.97 },
  terrace: null,
  sources: ['osm'],
  verified: null,
  horizon: null,
}

const send = () => screen.getByRole('button', { name: 'Enviar' })

function sentBody(fetchMock: { mock: { calls: unknown[][] } }): unknown {
  const init = fetchMock.mock.calls[0]?.[1]
  const body =
    init && typeof init === 'object' && 'body' in init ? init.body : null
  return JSON.parse(String(body))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReportPicker', () => {
  it('hands a move back once the pin has moved, and not too far', () => {
    const onPlace = vi.fn()
    const picking: Picking = { kind: 'move', venue, from: venue.venue }
    const picker = (center: { lat: number; lon: number }) => (
      <ReportPicker
        picking={picking}
        center={center}
        onPlace={onPlace}
        onClose={vi.fn()}
      />
    )
    const { rerender } = render(picker(venue.venue))
    const done = () => screen.getByRole('button', { name: 'Listo' })
    expect(screen.getByRole('region', { name: 'Mover Bar Uno' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Mueve el mapa hasta el sitio correcto',
    )
    expect(done()).toBeDisabled()

    // About 1.1 km north: the API would refuse it.
    rerender(picker({ lat: 38.888, lon: -6.97 }))
    expect(screen.getByRole('status')).toHaveTextContent('más de 500 m')
    expect(done()).toBeDisabled()

    // About 22 m north: no bot check here, the card's back sends it.
    rerender(picker({ lat: 38.8782, lon: -6.97 }))
    fireEvent.click(done())
    expect(onPlace).toHaveBeenCalledWith({ lat: 38.8782, lon: -6.97 })
  })

  it('adds a venue with a name, a kind and its terrace', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ReportPicker
        picking={{ kind: 'add' }}
        center={{ lat: 38.878, lon: -6.97 }}
        onPlace={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(send()).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), {
      target: { value: ' Bar, "Nuevo" ' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo' }), {
      target: { value: 'cafe' },
    })
    fireEvent.click(screen.getByRole('switch', { name: 'Tiene terraza' }))
    fireEvent.click(send())
    expect(await screen.findByText(/¡Gracias!/)).toBeInTheDocument()
    expect(sentBody(fetchMock)).toEqual({
      kind: 'add',
      name: 'Bar Nuevo',
      venueKind: 'cafe',
      terrace: false,
      lat: 38.878,
      lon: -6.97,
      token: 'token',
    })
  })

  it('refuses a place outside Badajoz and cancels on Escape', () => {
    const onClose = vi.fn()
    render(
      <ReportPicker
        picking={{ kind: 'add' }}
        center={{ lat: 38.95, lon: -6.97 }}
        onPlace={vi.fn()}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ese sitio está fuera de Badajoz.',
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
