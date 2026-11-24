import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { StartMoveContext } from './picking.ts'
import { SuggestChange } from './SuggestChange.tsx'

// Prices go through suggestPrice (its own API constant can't be mocked);
// reports reach fetch through reports.ts, which reads PRICES_API from here.
const { suggestPrice } = vi.hoisted(() => ({
  suggestPrice: vi.fn(async () => 'ok' as const),
}))
vi.mock('../prices/crowd.ts', async (original) => ({
  ...(await original<typeof import('../prices/crowd.ts')>()),
  PRICES_API: 'https://api.test',
  TURNSTILE_SITE_KEY: 'site-key',
  suggestPrice,
}))

// Cloudflare's widget: hands out a token per action straight away.
vi.mock('../prices/Turnstile.tsx', () => ({
  Turnstile: ({
    action,
    onToken,
  }: {
    action?: string
    onToken: (token: string) => void
  }) => {
    useEffect(() => onToken(`token-${action ?? ''}`), [onToken, action])
    return <span data-testid="turnstile">{action}</span>
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

type Sent = { url: string; body: unknown }

function stubFetch(status = 201): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(null, { status })
  })
  return sent
}

afterEach(() => {
  vi.unstubAllGlobals()
  suggestPrice.mockClear()
})

const send = () => screen.getByRole('button', { name: 'Enviar' })

describe('SuggestChange', () => {
  it('starts on the title and goes back', () => {
    const onBack = vi.fn()
    render(<SuggestChange venue={venue} onBack={onBack} />)
    expect(screen.getByText('Sugerir un cambio').parentElement).toHaveFocus()
    // Only the price check starts at once: one Cloudflare box at most.
    expect(
      screen.getAllByTestId('turnstile').map((t) => t.textContent),
    ).toEqual(['suggest'])
    expect(send()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('hands a move over to the map picker', () => {
    const startMove = vi.fn()
    render(
      <StartMoveContext value={startMove}>
        <SuggestChange venue={venue} onBack={() => {}} />
      </StartMoveContext>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Ubicación/ }))
    expect(startMove).toHaveBeenCalledWith(venue)
  })

  it('has no location row without the picker', () => {
    render(<SuggestChange venue={venue} onBack={() => {}} />)
    expect(screen.queryByRole('button', { name: /Ubicación/ })).toBeNull()
  })

  it('sends a tercio price with its brand', async () => {
    const sent = stubFetch()
    render(<SuggestChange venue={venue} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Tercio' }))
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'mahou-5-estrellas' },
    })
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Precio del tercio en euros' }),
      { target: { value: '2,20' } },
    )
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Lo mostraremos cuando varias personas coincidan.',
    )
    expect(suggestPrice).toHaveBeenCalledWith({
      venueId: 'osm:node/1',
      item: 'tercio',
      brand: 'mahou-5-estrellas',
      cents: 220,
      token: 'token-suggest',
    })
    expect(sent).toEqual([])
  })

  it('sends a price and a closed report together, each with its own check', async () => {
    const sent = stubFetch()
    render(<SuggestChange venue={venue} onBack={() => {}} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Precio de la caña en euros' }),
      { target: { value: '1,5' } },
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Ya no existe' }))
    expect(
      screen.getAllByTestId('turnstile').map((t) => t.textContent),
    ).toEqual(['suggest', 'report'])
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Lo revisaremos antes de publicarlo.',
    )
    expect(suggestPrice).toHaveBeenCalledWith(
      expect.objectContaining({
        item: 'cana',
        cents: 150,
        token: 'token-suggest',
      }),
    )
    expect(sent).toEqual([
      {
        url: 'https://api.test/v1/reports',
        body: { kind: 'closed', venueId: 'osm:node/1', token: 'token-report' },
      },
    ])
  })

  it('waits for a price in range', () => {
    render(<SuggestChange venue={venue} onBack={() => {}} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Precio de la caña en euros' }),
      { target: { value: '12' } },
    )
    expect(
      screen.getByText('Escribe un precio entre 0,50 € y 8,00 €.'),
    ).toBeInTheDocument()
    expect(send()).toBeDisabled()
  })

  it('says when there are too many reports', async () => {
    stubFetch(429)
    render(<SuggestChange venue={venue} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Ya no existe' }))
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Hay demasiados avisos enviados desde tu conexión. Prueba más tarde.',
    )
  })
})
