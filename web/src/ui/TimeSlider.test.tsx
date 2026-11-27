import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { nowMarker } from './nowMarker.ts'
import { daylight } from './daylight.ts'
import { TimeSlider } from './TimeSlider.tsx'

describe('nowMarker', () => {
  it('hides near the thumb, then shows the dot, then the label', () => {
    expect(nowMarker(840, 840)).toBe('none')
    expect(nowMarker(840, 855)).toBe('none')
    expect(nowMarker(840, 860)).toBe('dot')
    expect(nowMarker(840, 810)).toBe('dot')
    expect(nowMarker(840, 875)).toBe('label')
  })
})

describe('TimeSlider', () => {
  const slider = (minutes: number) =>
    render(
      <TimeSlider
        minutes={minutes}
        now={840}
        onChange={() => {}}
        onNow={() => {}}
        sunrise={480}
        sunset={1080}
      />,
    )

  it('keeps the dot tappable without the label 20 min away', () => {
    const { container } = slider(860)
    expect(
      screen.getByRole('button', { name: /Volver a ahora/ }),
    ).toBeInTheDocument()
    expect(container.querySelector('.time-now-bubble')).toBeNull()
  })

  it('shows Ahora an hour away', () => {
    const { container } = slider(900)
    expect(container.querySelector('.time-now-bubble')).toHaveTextContent(
      'Ahora',
    )
  })
})

describe('daylight on the bar (#537)', () => {
  it('puts sunrise and sunset in percent of 08:00–22:00, clamped to the bar', () => {
    expect(daylight(9 * 60, 18 * 60)).toEqual({
      rise: (1 / 14) * 100,
      set: (10 / 14) * 100,
    })
    expect(daylight(7 * 60, 23 * 60)).toEqual({ rise: 0, set: 100 })
    expect(daylight(null, null)).toEqual({ rise: 0, set: 100 })
  })

  it('marks the hours before sunrise and after sunset as night, and stops the fill at sunset', () => {
    const { container } = render(
      <TimeSlider
        minutes={21 * 60}
        now={840}
        onChange={() => {}}
        onNow={() => {}}
        sunrise={9 * 60}
        sunset={18 * 60}
      />,
    )
    const night = [...container.querySelectorAll('.time-tick.is-night')].map(
      (t) => t.textContent,
    )
    expect(night).toEqual(['08:00', '20:00', '22:00'])
    const input = container.querySelector('input')
    expect(input?.style.getPropertyValue('--fill')).toBe(`${(10 / 14) * 100}%`)
  })
})
