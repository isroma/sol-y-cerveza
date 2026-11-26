import { fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MapControls, MIN_INFO_HEIGHT } from './MapControls.tsx'
import { AUTHOR_URL, ISSUES_URL } from '../ui/PrivacyNotice.tsx'

// MapLibre needs WebGL; the controls only use its Marker for the user's dot.
vi.mock('maplibre-gl', () => ({ Marker: class {} }))

// The usage counters: opening the privacy notice must never count.
const telemetry = vi.hoisted(() => ({ track: vi.fn() }))
vi.mock('../telemetry.ts', () => telemetry)

function renderControls() {
  render(
    <MapControls
      mapRef={createRef()}
      ready={false}
      attribution={['© OpenStreetMap contributors (ODbL)']}
      leafOffTrees={false}
    />,
  )
  return screen.getByRole('button', { name: 'Información sobre los datos' })
}

describe('the privacy notice', () => {
  it('opens from "Sobre los datos", goes back, and closes with the info button', () => {
    const info = renderControls()
    fireEvent.click(info)
    const about = screen.getByRole('dialog', { name: 'Sobre los datos' })
    fireEvent.click(within(about).getByRole('button', { name: 'Privacidad' }))

    const notice = screen.getByRole('dialog', { name: 'Privacidad' })
    expect(
      within(notice).getByRole('heading', { name: 'Privacidad' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Sobre los datos' })).toBeNull()

    fireEvent.click(
      within(notice).getByRole('button', {
        name: 'Volver a Sobre los datos',
      }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Sobre los datos' }),
    ).toBeInTheDocument()

    // The info button closes it, and reopens on "Sobre los datos".
    fireEvent.click(screen.getByRole('button', { name: 'Privacidad' }))
    fireEvent.click(info)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(info)
    expect(
      screen.getByRole('dialog', { name: 'Sobre los datos' }),
    ).toBeInTheDocument()
    expect(telemetry.track).not.toHaveBeenCalled()
  })

  it('moves focus to the back button and back to the link', () => {
    fireEvent.click(renderControls())
    fireEvent.click(screen.getByRole('button', { name: 'Privacidad' }))
    const back = screen.getByRole('button', {
      name: 'Volver a Sobre los datos',
    })
    expect(back).toHaveFocus()
    fireEvent.click(back)
    expect(screen.getByRole('button', { name: 'Privacidad' })).toHaveFocus()
  })

  it('caps the panel even when the room above the legend is unmeasurable', () => {
    fireEvent.click(renderControls())
    // jsdom lays nothing out: no .map-wrap here, so the cap is the minimum.
    expect(
      screen.getByRole('dialog', { name: 'Sobre los datos' }).style.maxHeight,
    ).toBe(`${MIN_INFO_HEIGHT}px`)
  })

  it('names the contact, the rights and the providers', () => {
    fireEvent.click(renderControls())
    fireEvent.click(screen.getByRole('button', { name: 'Privacidad' }))
    const notice = screen.getByRole('dialog', { name: 'Privacidad' })
    expect(
      within(notice).getByRole('link', { name: 'repositorio' }),
    ).toHaveAttribute('href', ISSUES_URL)
    expect(
      within(notice).getByRole('link', { name: 'isroma' }),
    ).toHaveAttribute('href', AUTHOR_URL)
    expect(
      within(notice).getByRole('link', { name: 'www.aepd.es' }),
    ).toHaveAttribute('href', 'https://www.aepd.es')
    const text = notice.textContent ?? ''
    for (const phrase of [
      'Responsable.',
      'No usamos cookies',
      'no hay cuentas para visitantes',
      'tu posición no se envía a nadie',
      'se descargan las teselas de la zona',
      'Global Privacy Control o Do Not Track',
      'dos códigos',
      'nunca la dirección en sí',
      'interés legítimo',
      'los borramos si nos lo pides',
      'sin nada sobre quién lo envió',
      'GitHub Pages',
      'OpenFreeMap',
      'Cloudflare',
      'fuera de la UE',
      'acceso, rectificación, borrado, limitación u oposición, y la portabilidad',
    ])
      expect(text).toContain(phrase)
  })
})
