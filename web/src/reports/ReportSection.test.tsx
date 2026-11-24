import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { StartMoveContext, StartPinContext } from './picking.ts'
import { ReportSection } from './ReportSection.tsx'

vi.mock('../prices/crowd.ts', () => ({
  PRICES_API: 'https://api.test',
  TURNSTILE_SITE_KEY: 'site-key',
}))

// Cloudflare's widget: hands out a token straight away, and shows its action.
vi.mock('../prices/Turnstile.tsx', () => ({
  Turnstile: ({
    action,
    onToken,
  }: {
    action?: string
    onToken: (token: string) => void
  }) => {
    useEffect(() => onToken('token'), [onToken])
    return <span data-testid="turnstile">{action}</span>
  },
}))

const venue: Terrace = {
  id: 'osm:node/1',
  name: 'Bar Uno',
  kind: 'bar',
  venue: { lat: 38.878, lon: -6.97 },
  terrace: { lat: 38.878, lon: -6.97 },
  sources: ['osm'],
  verified: null,
  horizon: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReportSection', () => {
  it('offers the two reports behind one quiet link', () => {
    const startMove = vi.fn()
    render(
      <StartMoveContext value={startMove}>
        <ReportSection venue={venue} />
      </StartMoveContext>,
    )
    fireEvent.click(screen.getByRole('button', { name: '¿Algo está mal?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Está en otro sitio' }))
    expect(startMove).toHaveBeenCalledWith(venue)

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(
      screen.getByRole('button', { name: '¿Algo está mal?' }),
    ).toHaveFocus()
  })

  it('confirms a closed venue and thanks the visitor', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<ReportSection venue={venue} />)
    fireEvent.click(screen.getByRole('button', { name: '¿Algo está mal?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ya no existe' }))
    expect(
      screen.getByText('¿Seguro que ha cerrado o ya no existe?'),
    ).toHaveFocus()
    expect(screen.getByTestId('turnstile')).toHaveTextContent('report')

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Lo revisaremos antes de publicarlo.',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/reports',
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'closed',
          venueId: 'osm:node/1',
          token: 'token',
        }),
      }),
    )
  })

  it('says when there are too many reports', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 429 }))
    render(<ReportSection venue={venue} />)
    fireEvent.click(screen.getByRole('button', { name: '¿Algo está mal?' }))
    // Without the picker (no provider), only "Ya no existe" is offered.
    expect(
      screen.queryByRole('button', { name: 'Está en otro sitio' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ya no existe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Hay demasiados avisos enviados desde tu conexión. Prueba más tarde.',
    )
  })

  it('asks "¿Tiene terraza?" when the terrace is unconfirmed and answers in one tap', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const startPin = vi.fn()
    const unconfirmed = { ...venue, terrace: null }
    render(
      <StartPinContext value={startPin}>
        <ReportSection venue={unconfirmed} />
      </StartPinContext>,
    )
    expect(screen.queryByRole('button', { name: '¿Algo está mal?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '¿Tiene terraza?' }))
    expect(screen.getByTestId('turnstile')).toHaveTextContent('report')
    fireEvent.click(screen.getByRole('button', { name: 'Sí, tiene terraza' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Lo revisaremos antes de publicarlo.',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/reports',
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'terrace',
          venueId: 'osm:node/1',
          terrace: true,
          token: 'token',
        }),
      }),
    )
    // After a yes, the tables can be placed.
    fireEvent.click(
      screen.getByRole('button', { name: 'Marcar dónde están las mesas' }),
    )
    expect(startPin).toHaveBeenCalledWith(unconfirmed)
  })

  it('offers to move a known terrace or say there is none', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const startPin = vi.fn()
    render(
      <StartPinContext value={startPin}>
        <ReportSection venue={venue} />
      </StartPinContext>,
    )
    fireEvent.click(screen.getByRole('button', { name: '¿Algo está mal?' }))
    expect(
      screen.queryByRole('button', { name: 'Sí, tiene terraza' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mover la terraza' }))
    expect(startPin).toHaveBeenCalledWith(venue)
    fireEvent.click(screen.getByRole('button', { name: 'No tiene terraza' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/reports',
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'terrace',
          venueId: 'osm:node/1',
          terrace: false,
          token: 'token',
        }),
      }),
    )
    // No offer to place tables after a no.
    expect(
      screen.queryByRole('button', { name: 'Marcar dónde están las mesas' }),
    ).toBeNull()
  })
})
