import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { sunBox } from '../ui/categoryStyle.ts'
import { PinCard, ShareButton } from './PinCard.tsx'

vi.mock('../prices/crowd.ts', async (original) => ({
  ...(await original<typeof import('../prices/crowd.ts')>()),
  PRICES_API: 'https://api.test',
  TURNSTILE_SITE_KEY: 'site-key',
  CAN_SUGGEST: true,
  useCrowdPrices: () => [],
}))

function status(patch: Partial<VenueStatus>): VenueStatus {
  return {
    venue: {
      id: 'curated:x',
      name: 'Café La Plaza',
      kind: 'cafe',
      venue: { lat: 38.88, lon: -6.97 },
      terrace: { lat: 38.88, lon: -6.97 },
      sources: ['curated'],
      verified: null,
      horizon: null,
    },
    hasTerrace: true,
    state: 'shade',
    category: 'nosun',
    timeline: null,
    sunUntil: null,
    nextSun: null,
    minutesLeft: null,
    ...patch,
  }
}

const at = 14 * 60 + 32

describe('sunBox', () => {
  it('says how much sun is left and until when', () => {
    expect(
      sunBox(status({ category: 'sun', sunUntil: 17 * 60 + 26 }), at),
    ).toEqual({ title: '2 h 54 min de sol', detail: 'Hasta las 17:26' })
  })

  it('says when the sun comes', () => {
    expect(sunBox(status({ category: 'soon', nextSun: at + 25 }), at)).toEqual({
      title: 'Sol en 25 min',
      detail: 'Desde las 14:57',
    })
  })

  it('covers no more sun, night and unknown', () => {
    expect(sunBox(status({}), at).title).toBe('Sin más sol hoy')
    expect(sunBox(status({ state: 'night' }), at).title).toBe('De noche')
    expect(sunBox(status({ category: 'unknown' }), at).title).toBe(
      'Sin datos de sol',
    )
  })
})

describe('PinCard', () => {
  it('shows the name, the sun left and a countdown of the sun spell', () => {
    // Sun from 12:00 to 17:26 (5-minute steps), shade before and after.
    const timeline = Array.from({ length: 288 }, (_, i) =>
      i >= 144 && i * 5 < 17 * 60 + 26 ? ('sun' as const) : ('shade' as const),
    )
    render(
      <PinCard
        status={status({ category: 'sun', sunUntil: 17 * 60 + 30, timeline })}
        minutes={at}
        sunset={18 * 60 + 4}
      />,
    )
    expect(screen.getByText('Café La Plaza')).toBeInTheDocument()
    expect(screen.getByText('Café · Terraza')).toBeInTheDocument()
    expect(screen.getByText('2 h 58 min de sol')).toBeInTheDocument()
    expect(screen.getByText('12:00')).toBeInTheDocument()
    expect(screen.getByText('17:30')).toBeInTheDocument()
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '178')
    expect(screen.queryByText('Posición sin verificar')).toBeNull()
  })

  it('turns round to suggest a change, and back', async () => {
    render(<PinCard status={status({})} minutes={at} sunset={18 * 60} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sugerir un cambio' }))
    // The sides swap halfway through the turn.
    fireEvent.click(await screen.findByRole('button', { name: 'Volver' }))
    expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeNull()
    expect(await screen.findByText('Café · Terraza')).toBeInTheDocument()
  })

  it('has no share button', () => {
    render(<PinCard status={status({})} minutes={at} sunset={18 * 60} />)
    expect(screen.queryByRole('button', { name: /Compartir/ })).toBeNull()
  })

  it('has no bar without sun', () => {
    const { container } = render(
      <PinCard status={status({})} minutes={at} sunset={18 * 60} />,
    )
    expect(container.querySelector('.sun-countdown')).toBeNull()
  })
})

// Not on the card for now (issue #233), but kept to bring back.
describe('ShareButton', () => {
  const button = () => (
    <ShareButton
      name="Café La Plaza"
      id="curated:x"
      text="Café La Plaza: 2 h 5 min de sol"
      minutes={at}
    />
  )

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  it('opens the share sheet with the venue, its sun and a link', async () => {
    const share = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, share })
    render(button())

    fireEvent.click(
      screen.getByRole('button', { name: 'Compartir Café La Plaza' }),
    )
    await waitFor(() => expect(share).toHaveBeenCalledOnce())
    expect(share).toHaveBeenCalledWith({
      title: 'Café La Plaza',
      text: 'Café La Plaza: 2 h 5 min de sol',
      url: expect.stringMatching(/\?t=14:32&v=curated:x$/),
    })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('copies the link where there is no share sheet', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      share: undefined,
      clipboard: { writeText },
    })
    window.history.replaceState(null, '', '/?utm=x')
    render(button())

    fireEvent.click(
      screen.getByRole('button', { name: 'Compartir Café La Plaza' }),
    )
    expect(await screen.findByText('Enlace copiado')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/\?utm=x&t=14:32&v=curated:x$/),
    )
  })

  it('says so when the link cannot be copied', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      share: undefined,
      clipboard: {
        writeText: async () => {
          throw new Error('denied')
        },
      },
    })
    render(button())

    fireEvent.click(
      screen.getByRole('button', { name: 'Compartir Café La Plaza' }),
    )
    expect(
      await screen.findByText('No se ha podido copiar el enlace'),
    ).toBeInTheDocument()
  })
})
