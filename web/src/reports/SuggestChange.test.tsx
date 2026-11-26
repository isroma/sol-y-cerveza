import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { emptyDraft, type ChangeDraft } from './draft.ts'
import { StartMoveContext } from './picking.ts'
import { SuggestChange } from './SuggestChange.tsx'
import { logIn, logOut } from '../prices/owner.ts'
import { refreshSunCorrections } from '../sun/corrections.ts'

// The API and the bot check as a build with both configured has them.
vi.mock('../apiClient.ts', async (original) => {
  vi.stubEnv('VITE_PRICES_API', 'https://api.test')
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
  return original()
})

// Cloudflare's widget: a token for its action once it is asked to run.
vi.mock('./Turnstile.tsx', () => ({
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

// Visitors' sun corrections as the API would serve them; none by default.
vi.mock('../sun/corrections.ts', async (original) => ({
  ...(await original<typeof import('../sun/corrections.ts')>()),
  useSunCorrections: () => [],
  refreshSunCorrections: vi.fn(),
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
  of = venue,
}: {
  start?: Partial<ChangeDraft>
  onBack?: () => void
  of?: Terrace
}) {
  const [draft, setDraft] = useState({ ...emptyDraft(of.id), ...start })
  return (
    <SuggestChange
      venue={of}
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
  vi.useRealTimers()
})

/** Under trees, 31° all round: shade all day at the winter solstice. */
const shady: Terrace = {
  ...venue,
  terrace: venue.venue,
  horizon: new Array<number>(360).fill(310),
}
const sunRow = () =>
  screen.queryByRole('switch', { name: 'Ahora mismo da el sol' })

/** The real present: 13:40 in Madrid at the winter solstice, sun 28° up. */
function middayInWinter() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-21T12:40:00Z'))
}

const send = () => screen.getByRole('button', { name: 'Enviar' })
const check = () => screen.getByTestId('turnstile')

describe('SuggestChange', () => {
  it('starts on the title, with one check running at once', () => {
    const onBack = vi.fn()
    render(<Back onBack={onBack} />)
    expect(screen.getByText('Sugerir un cambio').parentElement).toHaveFocus()
    expect(screen.getAllByTestId('turnstile')).toHaveLength(1)
    expect(check()).toHaveTextContent('change')
    expect(send()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('needs no new check once the token is in', () => {
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
      screen.getByText('Escribe un precio entre 0,50 € y 6,00 €.'),
    ).toBeInTheDocument()
    expect(send()).toBeDisabled()
  })

  it('uses the API range of each beer', () => {
    render(<Back />)
    const price = (name: string) => screen.getByRole('textbox', { name })
    // A caña above 6,00 € is refused by the API, though a tercio may cost it.
    fireEvent.change(price('Precio de la caña en euros'), {
      target: { value: '6,50' },
    })
    expect(
      screen.getByText('Escribe un precio entre 0,50 € y 6,00 €.'),
    ).toBeInTheDocument()
    expect(send()).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Tercio' }))
    expect(screen.queryByText(/Escribe un precio/)).not.toBeInTheDocument()
    // A tercio under 0,80 € is refused, though a caña may cost it.
    fireEvent.change(price('Precio del tercio en euros'), {
      target: { value: '0,60' },
    })
    expect(
      screen.getByText('Escribe un precio entre 0,80 € y 8,00 €.'),
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

describe('SuggestChange: the sun right now', () => {
  it('offers it where the app says shade now, with the sun up', () => {
    middayInWinter()
    render(<Back of={shady} />)
    expect(sunRow()).not.toBeChecked()
  })

  it('not without a horizon', () => {
    middayInWinter()
    render(<Back />)
    expect(sunRow()).toBeNull()
  })

  it('not with the sun down', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-21T21:00:00Z'))
    render(<Back of={shady} />)
    expect(sunRow()).toBeNull()
  })

  it('sends it alone and says it shows once three people agree', async () => {
    middayInWinter()
    const sent = stubFetch()
    render(<Back of={shady} />)
    expect(send()).toBeDisabled()
    fireEvent.click(sunRow() ?? document.body)
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Marcaremos el sol cuando tres personas coincidan.',
    )
    expect(sent).toEqual([
      {
        url: 'https://api.test/v1/changes',
        body: { venueId: venue.id, token: 'token-change', sun: true },
      },
    ])
  })

  it('sends it with a price as one change', async () => {
    middayInWinter()
    const sent = stubFetch()
    render(<Back of={shady} start={{ sun: true, text: '1,50' }} />)
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Lo mostraremos cuando varias personas coincidan.',
    )
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      price: { item: 'cana', brand: null, cents: 150 },
      sun: true,
    })
  })

  it('waits for review when sent with a closure', async () => {
    middayInWinter()
    stubFetch()
    render(<Back of={shady} start={{ sun: true, closed: true }} />)
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Lo revisaremos antes de publicarlo.',
    )
  })

  it('never sends it while the row is hidden', async () => {
    const sent = stubFetch()
    render(<Back start={{ sun: true, closed: true }} />)
    fireEvent.click(send())
    await screen.findByRole('status')
    expect(sent[0]?.body).not.toHaveProperty('sun')
  })

  it('shows a plain error when the API refuses it (sun down, older API)', async () => {
    middayInWinter()
    stubFetch(400)
    render(<Back of={shady} start={{ sun: true }} />)
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'No se ha podido enviar. Inténtalo más tarde.',
    )
  })
})

describe('SuggestChange: the terrace', () => {
  const yes = () => screen.getByRole('radio', { name: 'Sí' })
  const no = () => screen.getByRole('radio', { name: 'No' })
  const tables = () => screen.queryByRole('button', { name: /Mesas/ })
  const withPicker = (startMove = vi.fn()) => ({
    wrapper: ({ children }: { children: ReactNode }) => (
      <StartMoveContext value={startMove}>{children}</StartMoveContext>
    ),
  })
  /** A venue whose terrace the data has, 22 m south of the tables below. */
  const terraced: Terrace = { ...venue, terrace: venue.venue }
  const spot = { lat: 38.8782, lon: -6.97 }

  it('asks where the data does not know, with nothing chosen', () => {
    render(<Back />, withPicker())
    expect(yes()).not.toBeChecked()
    expect(no()).not.toBeChecked()
    expect(tables()).toBeNull()
    expect(send()).toBeDisabled()
    // Sí offers the tables; tapping it again takes the answer back.
    fireEvent.click(yes())
    expect(yes()).toBeChecked()
    expect(tables()).toHaveTextContent('Marcar en el mapa')
    expect(send()).toBeEnabled()
    fireEvent.click(yes())
    expect(yes()).not.toBeChecked()
    expect(tables()).toBeNull()
    expect(send()).toBeDisabled()
  })

  it('sends Sí alone, to be reviewed', async () => {
    const sent = stubFetch()
    render(<Back start={{ terrace: true }} />)
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Lo revisaremos antes de publicarlo.',
    )
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      terrace: true,
    })
  })

  it('hands the tables to the picker and sends them with Sí', async () => {
    const startMove = vi.fn()
    const sent = stubFetch()
    render(<Back start={{ terrace: true, pin: spot }} />, withPicker(startMove))
    const row = tables()
    expect(row).toHaveTextContent('Marcadas a 22 m')
    fireEvent.click(row ?? document.body)
    expect(startMove).toHaveBeenCalledWith(venue, 'pin')
    fireEvent.click(send())
    await screen.findByRole('status')
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      terrace: true,
      pin: spot,
    })
  })

  it('says tables marked in place are by the bar', () => {
    render(<Back start={{ terrace: true, pin: venue.venue }} />, withPicker())
    expect(tables()).toHaveTextContent('Marcadas junto al bar')
  })

  it('drops the tables on No, and never sends them with it', async () => {
    const sent = stubFetch()
    render(<Back start={{ terrace: true, pin: spot }} />, withPicker())
    fireEvent.click(no())
    expect(no()).toBeChecked()
    expect(tables()).toBeNull()
    fireEvent.click(yes())
    // The tables marked before No are gone.
    expect(tables()).toHaveTextContent('Marcar en el mapa')
    fireEvent.click(no())
    fireEvent.click(send())
    await screen.findByRole('status')
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      terrace: false,
    })
  })

  it('moves the tables of a known terrace, without asking', async () => {
    const startMove = vi.fn()
    const sent = stubFetch()
    render(<Back of={terraced} start={{ pin: spot }} />, withPicker(startMove))
    expect(screen.queryByRole('radio', { name: 'Sí' })).toBeNull()
    const row = tables()
    expect(row).toHaveTextContent('Movidas 22 m')
    fireEvent.click(row ?? document.body)
    expect(startMove).toHaveBeenCalledWith(terraced, 'pin')
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Lo revisaremos',
    )
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      pin: spot,
    })
  })

  it('says a known terrace is not there, dropping its tables', async () => {
    const sent = stubFetch()
    render(<Back of={terraced} start={{ pin: spot }} />, withPicker())
    expect(tables()).toHaveTextContent('Movidas')
    fireEvent.click(screen.getByRole('switch', { name: 'No tiene terraza' }))
    expect(tables()).toBeNull()
    fireEvent.click(send())
    await screen.findByRole('status')
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      terrace: false,
    })
  })

  it('starts the tables of a known terrace at "Mover en el mapa"', () => {
    render(<Back of={terraced} />, withPicker())
    expect(tables()).toHaveTextContent('Mover en el mapa')
    expect(send()).toBeDisabled()
  })
})

describe('SuggestChange in owner mode', () => {
  const ownerOn = async () => {
    vi.stubGlobal('fetch', async () => Response.json({ token: 'owner' }))
    await logIn('dueño', 'secreto')
  }
  afterEach(() => logOut())

  it('saves a price as a change, with no bot check', async () => {
    await ownerOn()
    const sent = stubFetch()
    render(<Back />)
    expect(screen.getByText('Editar')).toBeInTheDocument()
    expect(screen.queryByTestId('turnstile')).toBeNull()
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Precio de la caña en euros' }),
      { target: { value: '1,80' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'El precio ya se ve',
    )
    expect(sent[0]).toEqual({
      url: 'https://api.test/v1/owner/changes',
      body: {
        venueId: venue.id,
        price: { item: 'cana', brand: null, cents: 180 },
      },
    })
  })

  it('says a closure waits for the next Publish', async () => {
    await ownerOn()
    stubFetch()
    render(<Back start={{ closed: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'próxima publicación',
    )
  })

  it('says the terrace and its tables wait for the next Publish', async () => {
    await ownerOn()
    const sent = stubFetch()
    const pin = { lat: 38.8782, lon: -6.97 }
    render(<Back start={{ terrace: true, pin }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Guardado. Se aplicará en la próxima publicación.',
    )
    expect(sent[0]).toEqual({
      url: 'https://api.test/v1/owner/changes',
      body: { venueId: venue.id, terrace: true, pin },
    })
  })

  it('saves the sun at once, and fetches the corrections again', async () => {
    await ownerOn()
    middayInWinter()
    const sent = stubFetch()
    render(<Back of={shady} start={{ sun: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Guardado. El sol ya se ve en el mapa.',
    )
    expect(sent[0]).toEqual({
      url: 'https://api.test/v1/owner/changes',
      body: { venueId: venue.id, sun: true },
    })
    expect(refreshSunCorrections).toHaveBeenCalled()
  })
})
