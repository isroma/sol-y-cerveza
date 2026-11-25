import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SunState } from '../sun/sunState.ts'
import { SunDay } from './SunDay.tsx'

// Night until 08:30 and from 18:00; sun 10:00–14:00; shade otherwise.
const timeline: SunState[] = Array.from({ length: 288 }, (_, i) =>
  i < 102 || i >= 216 ? 'night' : i >= 120 && i < 168 ? 'sun' : 'shade',
)

const parts = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('.sun-day-part')].map((el) => [
    el.className.replace('sun-day-part is-', ''),
    // Minutes after 08:00, back from the percentages (840 min = 100 %).
    Math.round((parseFloat(el.style.left) / 100) * 840),
    Math.round((parseFloat(el.style.width) / 100) * 840),
  ])

describe('SunDay', () => {
  it('draws the day from 08:00 to 22:00 as stretches of sun, shade and night', () => {
    const { container } = render(<SunDay timeline={timeline} minutes={720} />)
    expect(parts(container)).toEqual([
      ['night', 0, 30],
      ['shade', 30, 90],
      ['sun', 120, 240],
      ['shade', 360, 240],
      ['night', 600, 240],
    ])
    expect(screen.getByText('08:00')).toBeInTheDocument()
    expect(screen.getByText('22:00')).toBeInTheDocument()
  })

  it('puts the line at the chosen time, and moves it with the time', () => {
    const { container, rerender } = render(
      <SunDay timeline={timeline} minutes={8 * 60} />,
    )
    const line = () =>
      container.querySelector<HTMLElement>('.sun-day-now')?.style.left
    expect(line()).toBe('0%')
    rerender(<SunDay timeline={timeline} minutes={15 * 60} />)
    expect(line()).toBe('50%')
  })

  it('shows in shade too, and names the sun spells for screen readers', () => {
    render(<SunDay timeline={timeline} minutes={16 * 60} />)
    expect(
      screen.getByRole('img', { name: 'Sol hoy: de 10:00 a 14:00' }),
    ).toBeInTheDocument()
  })

  it('says when there is no sun all day', () => {
    render(<SunDay timeline={timeline.map(() => 'shade')} minutes={12 * 60} />)
    expect(screen.getByRole('img', { name: 'Sin sol hoy' })).toBeInTheDocument()
  })
})
