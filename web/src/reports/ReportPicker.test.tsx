import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import type { Picking } from './picking.ts'
import { ReportPicker } from './ReportPicker.tsx'

vi.mock('../prices/crowd.ts', () => ({
  PRICES_API: 'https://api.test',
  TURNSTILE_SITE_KEY: 'site-key',
}))

vi.mock('../prices/Turnstile.tsx', () => ({
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
  it('sends a move only once the pin has moved, and not too far', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const picking: Picking = { kind: 'move', venue }
    const { rerender } = render(
      <ReportPicker picking={picking} center={venue.venue} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('region', { name: 'Mover Bar Uno' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Mueve el mapa hasta el sitio correcto',
    )
    expect(send()).toBeDisabled()

    // About 1.1 km north: the API would refuse it.
    rerender(
      <ReportPicker
        picking={picking}
        center={{ lat: 38.888, lon: -6.97 }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('más de 500 m')
    expect(send()).toBeDisabled()

    // About 22 m north.
    rerender(
      <ReportPicker
        picking={picking}
        center={{ lat: 38.8782, lon: -6.97 }}
        onClose={vi.fn()}
      />,
    )
    expect(send()).toBeEnabled()
    fireEvent.click(send())
    expect(await screen.findByText(/¡Gracias!/)).toBeInTheDocument()
    expect(sentBody(fetchMock)).toEqual({
      kind: 'move',
      venueId: 'osm:node/1',
      lat: 38.8782,
      lon: -6.97,
      token: 'token',
    })
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

  it('places the tables of a venue, within 150 m', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const picking: Picking = { kind: 'pin', venue }
    const { rerender } = render(
      <ReportPicker picking={picking} center={venue.venue} onClose={vi.fn()} />,
    )
    expect(
      screen.getByRole('region', { name: 'Terraza de Bar Uno' }),
    ).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Mueve el mapa hasta las mesas',
    )
    // No terrace yet: tables right at the door are a fine answer.
    expect(send()).toBeEnabled()

    // About 220 m north: too far for a terrace.
    rerender(
      <ReportPicker
        picking={picking}
        center={{ lat: 38.88, lon: -6.97 }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('menos de 150 m')
    expect(send()).toBeDisabled()

    rerender(
      <ReportPicker
        picking={picking}
        center={{ lat: 38.8781, lon: -6.97 }}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(send())
    expect(await screen.findByText(/Gracias/)).toBeInTheDocument()
    expect(sentBody(fetchMock)).toEqual({
      kind: 'pin',
      venueId: 'osm:node/1',
      lat: 38.8781,
      lon: -6.97,
      token: 'token',
    })
  })

  it('moving a known terrace needs the pin to move', () => {
    const withTerrace = { ...venue, terrace: { lat: 38.878, lon: -6.97 } }
    render(
      <ReportPicker
        picking={{ kind: 'pin', venue: withTerrace }}
        center={withTerrace.venue}
        onClose={vi.fn()}
      />,
    )
    expect(send()).toBeDisabled()
  })

  it('refuses a place outside Badajoz and cancels on Escape', () => {
    const onClose = vi.fn()
    render(
      <ReportPicker
        picking={{ kind: 'add' }}
        center={{ lat: 38.95, lon: -6.97 }}
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
