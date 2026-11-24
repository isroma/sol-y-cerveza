import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { PickBar } from './PickBar.tsx'
import { ReportSection } from './ReportSection.tsx'

vi.mock('../prices/crowd.ts', () => ({
  PRICES_API: 'https://api.test',
  TURNSTILE_SITE_KEY: 'site-key',
}))

// Cloudflare's widget, replaced by one that hands out a token at once.
vi.mock('../prices/Turnstile.tsx', () => ({
  Turnstile: ({
    action,
    onToken,
  }: {
    action: string
    onToken: (token: string) => void
  }) => {
    useEffect(() => onToken(`token-for-${action}`), [action, onToken])
    return null
  },
}))

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

const venue: Terrace = {
  id: 'osm:node/1',
  name: 'Bar Pepe',
  kind: 'bar',
  venue: { lat: 38.878, lon: -6.97 },
  terrace: null,
  sources: ['osm'],
  verified: null,
  horizon: null,
}

function sentBody(): unknown {
  const init = fetchMock.mock.calls[0]?.[1]
  return typeof init?.body === 'string' ? JSON.parse(init.body) : null
}

describe('ReportSection', () => {
  it('asks about the terrace when it is unconfirmed, and sends the answer in one tap', async () => {
    const onPick = vi.fn()
    render(<ReportSection venue={venue} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: '¿Tiene terraza?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, tiene terraza' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Gracias. Lo revisaremos antes de publicarlo.',
    )
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/reports')
    expect(sentBody()).toEqual({
      kind: 'terrace',
      venueId: 'osm:node/1',
      terrace: true,
      token: 'token-for-report',
    })
    // A yes offers to place the tables.
    fireEvent.click(
      screen.getByRole('button', { name: 'Marcar dónde están las mesas' }),
    )
    expect(onPick).toHaveBeenCalledWith('pin')
  })

  it('offers to move a confirmed terrace and confirms a closure first', async () => {
    const onPick = vi.fn()
    render(
      <ReportSection
        venue={{ ...venue, terrace: venue.venue }}
        onPick={onPick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '¿Algo está mal?' }))
    expect(screen.queryByRole('button', { name: 'Sí, tiene terraza' })).toBe(
      null,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'La terraza está en otro sitio' }),
    )
    expect(onPick).toHaveBeenCalledWith('pin')
    fireEvent.click(
      screen.getByRole('button', { name: 'El bar está en otro sitio' }),
    )
    expect(onPick).toHaveBeenCalledWith('move')

    fireEvent.click(
      screen.getByRole('button', { name: 'Ha cerrado o no existe' }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() =>
      expect(sentBody()).toEqual({
        kind: 'closed',
        venueId: 'osm:node/1',
        token: 'token-for-report',
      }),
    )
  })

  it('says when the API refuses', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }))
    render(<ReportSection venue={venue} onPick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '¿Tiene terraza?' }))
    fireEvent.click(screen.getByRole('button', { name: 'No tiene terraza' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Hay demasiados avisos',
    )
  })
})

describe('PickBar', () => {
  it('sends the point under the centre pin', async () => {
    const onClose = vi.fn()
    render(
      <PickBar
        pick={{
          kind: 'move',
          venueId: 'osm:node/1',
          name: 'Bar Pepe',
          from: venue.venue,
          start: venue.venue,
        }}
        center={() => ({ lat: 38.8781, lon: -6.9701 })}
        onClose={onClose}
      />,
    )
    expect(
      screen.getByText('Mueve el mapa hasta la puerta de Bar Pepe'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() =>
      expect(sentBody()).toEqual({
        kind: 'move',
        venueId: 'osm:node/1',
        lat: 38.8781,
        lon: -6.9701,
        token: 'token-for-report',
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses a point too far away without sending', () => {
    render(
      <PickBar
        pick={{
          kind: 'pin',
          venueId: 'osm:node/1',
          name: 'Bar Pepe',
          from: venue.venue,
          start: venue.venue,
        }}
        center={() => ({ lat: 38.88, lon: -6.97 })}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('150 m')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('needs a name for a missing bar', async () => {
    render(
      <PickBar
        pick={{ kind: 'add' }}
        center={() => venue.venue}
        onClose={vi.fn()}
      />,
    )
    const send = screen.getByRole('button', { name: 'Enviar' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del bar' }), {
      target: { value: 'Bar Nuevo' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo' }), {
      target: { value: 'cafe' },
    })
    fireEvent.click(screen.getByRole('switch', { name: 'Tiene terraza' }))
    fireEvent.click(send)
    await waitFor(() =>
      expect(sentBody()).toEqual({
        kind: 'add',
        name: 'Bar Nuevo',
        venueKind: 'cafe',
        terrace: false,
        ...venue.venue,
        token: 'token-for-report',
      }),
    )
  })
})
