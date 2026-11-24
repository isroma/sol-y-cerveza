import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { emptyDraft, type ChangeDraft } from './draft.ts'
import { StartMoveContext } from './picking.ts'
import { SuggestChange } from './SuggestChange.tsx'

vi.mock('../prices/crowd.ts', async (original) => ({
  ...(await original<typeof import('../prices/crowd.ts')>()),
  PRICES_API: 'https://api.test',
  TURNSTILE_SITE_KEY: 'site-key',
}))

// Cloudflare's widget: a token for its action once it is asked to run.
vi.mock('../prices/Turnstile.tsx', () => ({
  Turnstile: ({
    action,
    run,
    onToken,
  }: {
    action?: string
    run?: boolean
    onToken: (token: string) => void
  }) => {
    useEffect(() => {
      if (run !== false) onToken(`token-${action ?? ''}`)
    }, [onToken, action, run])
    return (
      <span data-testid="turnstile" data-run={String(run !== false)}>
        {action}
      </span>
    )
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

/** The back with its draft kept here, as App keeps it. */
function Back({
  start = {},
  onBack = () => {},
}: {
  start?: Partial<ChangeDraft>
  onBack?: () => void
}) {
  const [draft, setDraft] = useState({ ...emptyDraft(venue.id), ...start })
  return (
    <SuggestChange
      venue={venue}
      draft={draft}
      onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      onBack={onBack}
    />
  )
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
})

const send = () => screen.getByRole('button', { name: 'Enviar' })
const check = () => screen.getByTestId('turnstile')

describe('SuggestChange', () => {
  it('starts on the title, with one check waiting for an edit', () => {
    const onBack = vi.fn()
    render(<Back onBack={onBack} />)
    expect(screen.getByText('Sugerir un cambio').parentElement).toHaveFocus()
    expect(screen.getAllByTestId('turnstile')).toHaveLength(1)
    expect(check()).toHaveTextContent('change')
    expect(check()).toHaveAttribute('data-run', 'false')
    expect(send()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('runs the check on the first edit, once', () => {
    render(<Back />)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Precio de la caña en euros' }),
      { target: { value: '1,50' } },
    )
    // The token arrived: Enviar is ready, and the check isn't asked again.
    expect(send()).toBeEnabled()
    expect(check()).toHaveAttribute('data-run', 'false')
  })

  it.each([
    ['reuses a fresh token from before the trip to the map', 'kept', 1],
    ['drops a stale token and checks again', 'token-change', 0],
  ])('%s', async (_, used, age) => {
    const sent = stubFetch()
    render(
      <Back
        start={{
          closed: true,
          token: age ? 'kept' : 'old',
          tokenAt: age ? Date.now() : 0,
        }}
      />,
    )
    fireEvent.click(send())
    await screen.findByRole('status')
    expect(sent[0]?.body).toMatchObject({ token: used })
  })

  it('hands a move over to the map picker, and shows where it was placed', () => {
    const startMove = vi.fn()
    render(
      <StartMoveContext value={startMove}>
        <Back start={{ move: { lat: 38.8782, lon: -6.97 } }} />
      </StartMoveContext>,
    )
    const row = screen.getByRole('button', { name: /Ubicación/ })
    expect(row).toHaveTextContent('Movida 22 m')
    fireEvent.click(row)
    expect(startMove).toHaveBeenCalledWith(venue)
  })

  it('has no location row without the picker', () => {
    render(<Back />)
    expect(screen.queryByRole('button', { name: /Ubicación/ })).toBeNull()
  })

  it('sends a tercio price with its brand', async () => {
    const sent = stubFetch()
    render(<Back />)
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
    expect(sent).toEqual([
      {
        url: 'https://api.test/v1/changes',
        body: {
          venueId: 'osm:node/1',
          token: 'token-change',
          price: { item: 'tercio', brand: 'mahou-5-estrellas', cents: 220 },
        },
      },
    ])
  })

  it('sends a price, a move and closed in one request', async () => {
    const sent = stubFetch()
    render(<Back start={{ move: { lat: 38.8782, lon: -6.97 } }} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Precio de la caña en euros' }),
      { target: { value: '1,5' } },
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Ya no existe' }))
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Lo revisaremos antes de publicarlo.',
    )
    expect(sent).toEqual([
      {
        url: 'https://api.test/v1/changes',
        body: {
          venueId: 'osm:node/1',
          token: 'token-change',
          price: { item: 'cana', brand: null, cents: 150 },
          move: { lat: 38.8782, lon: -6.97 },
          closed: true,
        },
      },
    ])
  })

  it('waits for a price in range', () => {
    render(<Back />)
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
    render(<Back />)
    fireEvent.click(screen.getByRole('switch', { name: 'Ya no existe' }))
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Hay demasiados avisos enviados desde tu conexión. Prueba más tarde.',
    )
  })
})
