import { fireEvent, render, screen, within } from '@testing-library/react'
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
const closedButton = () => screen.getByRole('button', { name: 'Ya no existe' })
const terraceSwitch = () =>
  screen.getByRole('switch', { name: 'Tiene terraza' })
const priceBox = () =>
  screen.queryByRole('textbox', { name: 'Precio de la caña en euros' })
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
    const row = screen.getByRole('group', { name: 'Mover' })
    const bar = within(row).getByRole('button', { name: 'Bar · 22 m' })
    fireEvent.click(bar)
    expect(startMove).toHaveBeenCalledWith(venue)
  })

  it('has no Mover row without the picker', () => {
    render(<Back />)
    expect(screen.queryByRole('group', { name: 'Mover' })).toBeNull()
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

  it('sends a price and a move in one request', async () => {
    const sent = stubFetch()
    render(<Back start={{ move: { lat: 38.8782, lon: -6.97 } }} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Precio de la caña en euros' }),
      { target: { value: '1,5' } },
    )
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
    fireEvent.click(closedButton())
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

  it('is not sent with a closure, which goes alone', async () => {
    middayInWinter()
    const sent = stubFetch()
    render(<Back of={shady} start={{ sun: true, closed: true }} />)
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Lo revisaremos antes de publicarlo.',
    )
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      closed: true,
    })
  })

  it('folds away with the terrace switched off, and is not sent', async () => {
    middayInWinter()
    const sent = stubFetch()
    render(<Back of={shady} start={{ sun: true }} />)
    expect(sunRow()).toBeChecked()
    fireEvent.click(terraceSwitch())
    expect(sunRow()).toBeNull()
    fireEvent.click(send())
    await screen.findByRole('status')
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      terrace: false,
    })
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

describe('SuggestChange: shade right now', () => {
  /** Open sky: sun all day. */
  const sunny: Terrace = {
    ...venue,
    terrace: venue.venue,
    horizon: new Array<number>(360).fill(0),
  }
  const shadeRow = () =>
    screen.queryByRole('switch', { name: 'Ahora mismo hay sombra' })

  it('offers shade where the app says sun, and not sun', () => {
    middayInWinter()
    render(<Back of={sunny} />)
    expect(shadeRow()).not.toBeNull()
    expect(sunRow()).toBeNull()
  })

  it('sends shade and says it shows once three people agree', async () => {
    middayInWinter()
    const sent = stubFetch()
    render(<Back of={sunny} />)
    fireEvent.click(shadeRow() ?? document.body)
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Marcaremos la sombra cuando tres personas coincidan.',
    )
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      shade: true,
    })
  })

  it('says why when the sun is not out', async () => {
    middayInWinter()
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'not sunny' }, { status: 400 }),
    )
    render(<Back of={sunny} />)
    fireEvent.click(shadeRow() ?? document.body)
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ahora no luce el sol en Badajoz',
    )
  })
})

describe('SuggestChange: the terrace', () => {
  const tables = () => screen.queryByRole('button', { name: /mesas/i })
  const withPicker = (startMove = vi.fn()) => ({
    wrapper: ({ children }: { children: ReactNode }) => (
      <StartMoveContext value={startMove}>{children}</StartMoveContext>
    ),
  })
  /** A venue whose terrace the data has, 22 m south of the tables below. */
  const terraced: Terrace = { ...venue, terrace: venue.venue }
  const spot = { lat: 38.8782, lon: -6.97 }

  it('starts off where the data has no terrace, with no tables', () => {
    render(<Back />, withPicker())
    expect(terraceSwitch()).not.toBeChecked()
    expect(tables()).toBeNull()
    expect(send()).toBeDisabled()
    // On offers the tables; off again is back where it started.
    fireEvent.click(terraceSwitch())
    expect(terraceSwitch()).toBeChecked()
    expect(tables()).toHaveTextContent('Mover mesas')
    expect(send()).toBeEnabled()
    fireEvent.click(terraceSwitch())
    expect(tables()).toBeNull()
    expect(send()).toBeDisabled()
  })

  it('starts on where the data has a terrace, with its tables', () => {
    render(<Back of={terraced} />, withPicker())
    expect(terraceSwitch()).toBeChecked()
    expect(tables()).toHaveTextContent('Mover mesas')
    expect(send()).toBeDisabled()
  })

  it('is the same switch on every venue, with no "No tiene terraza"', () => {
    render(<Back of={terraced} />, withPicker())
    expect(screen.queryByText('No tiene terraza')).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Sí' })).toBeNull()
  })

  it('sends "tiene terraza" alone, to be reviewed', async () => {
    const sent = stubFetch()
    render(<Back />)
    fireEvent.click(terraceSwitch())
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

  it("sends the front's No on a venue the data doesn't know", async () => {
    const sent = stubFetch()
    render(<Back start={{ terrace: false }} />)
    expect(terraceSwitch()).not.toBeChecked()
    fireEvent.click(send())
    await screen.findByRole('status')
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      terrace: false,
    })
  })

  it('hands the tables to the picker and sends them with the terrace', async () => {
    const startMove = vi.fn()
    const sent = stubFetch()
    render(<Back start={{ terrace: true, pin: spot }} />, withPicker(startMove))
    const pill = tables()
    expect(pill).toHaveTextContent('Mesas · 22 m')
    fireEvent.click(pill ?? document.body)
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

  it('says tables marked in place are where the picker said', () => {
    render(<Back start={{ terrace: true, pin: venue.venue }} />, withPicker())
    expect(tables()).toHaveTextContent('Mesas · aquí')
  })

  it('moves the tables of a known terrace', async () => {
    const startMove = vi.fn()
    const sent = stubFetch()
    render(<Back of={terraced} start={{ pin: spot }} />, withPicker(startMove))
    const pill = tables()
    expect(pill).toHaveTextContent('Mesas · 22 m')
    fireEvent.click(pill ?? document.body)
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

  it('switched off, folds the tables away; a price and a move still go', async () => {
    const sent = stubFetch()
    const move = { lat: 38.8779, lon: -6.97 }
    render(
      <Back of={terraced} start={{ pin: spot, move, text: '1,50' }} />,
      withPicker(),
    )
    fireEvent.click(terraceSwitch())
    expect(tables()).toBeNull()
    // The bar can still move.
    expect(screen.getByRole('button', { name: /^Bar · / })).toBeVisible()
    fireEvent.click(send())
    await screen.findByRole('status')
    expect(sent[0]?.body).toEqual({
      venueId: venue.id,
      token: 'token-change',
      price: { item: 'cana', brand: null, cents: 150 },
      move,
      terrace: false,
    })
  })

  it('brings the tables back when switched on again', () => {
    render(<Back of={terraced} start={{ pin: spot }} />, withPicker())
    fireEvent.click(terraceSwitch())
    fireEvent.click(terraceSwitch())
    expect(terraceSwitch()).toBeChecked()
    expect(tables()).toHaveTextContent('Mesas · 22 m')
  })

  it('keeps folded rows out of the tab order', () => {
    render(<Back of={terraced} />, withPicker())
    const pill = screen.getByRole('button', { name: 'Mover mesas' })
    expect(pill.closest('[inert]')).toBeNull()
    fireEvent.click(terraceSwitch())
    const folded = pill.closest('.change-fold')
    expect(folded).toHaveAttribute('inert')
    expect(folded).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('SuggestChange: Ya no existe', () => {
  const line = 'Avisaremos de que este bar ha cerrado. No hace falta nada más.'

  it('is a toggle button, off at first, its line folded', () => {
    render(<Back />)
    expect(closedButton()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(line).closest('.change-fold')).toHaveAttribute(
      'inert',
    )
    fireEvent.click(closedButton())
    expect(closedButton()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(line).closest('.change-fold')).not.toHaveAttribute(
      'inert',
    )
  })

  it('folds the form away, out of the tab order', () => {
    render(<Back />)
    const group = document.querySelector('.change-group')
    expect(group?.closest('[inert]')).toBeNull()
    fireEvent.click(closedButton())
    expect(priceBox()).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Tiene terraza' })).toBeNull()
    expect(group?.closest('[inert]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('goes alone, whatever else was filled in', async () => {
    const sent = stubFetch()
    render(
      <Back
        start={{
          text: '1,50',
          move: { lat: 38.8782, lon: -6.97 },
          terrace: true,
          pin: { lat: 38.8782, lon: -6.97 },
        }}
      />,
    )
    fireEvent.click(closedButton())
    fireEvent.click(send())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '¡Gracias! Lo revisaremos antes de publicarlo.',
    )
    expect(sent).toEqual([
      {
        url: 'https://api.test/v1/changes',
        body: { venueId: venue.id, token: 'token-change', closed: true },
      },
    ])
  })

  it('goes even with a price out of range typed before', () => {
    render(<Back start={{ text: '12' }} />)
    expect(send()).toBeDisabled()
    fireEvent.click(closedButton())
    expect(send()).toBeEnabled()
  })

  it('brings back what was typed when turned off', () => {
    render(<Back start={{ text: '1,50', terrace: true }} />)
    fireEvent.click(closedButton())
    fireEvent.click(closedButton())
    expect(priceBox()).toHaveValue('1,50')
    expect(terraceSwitch()).toBeChecked()
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

  it('says a closure waits for the next Publish, and saves it alone', async () => {
    await ownerOn()
    const sent = stubFetch()
    render(<Back start={{ closed: true, text: '1,80' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'próxima publicación',
    )
    expect(sent[0]?.body).toEqual({ venueId: venue.id, closed: true })
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
