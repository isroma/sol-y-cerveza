import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { nowMarker } from './nowMarker.ts'
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
