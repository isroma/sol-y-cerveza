import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SunState } from '../sun/sunState.ts'
import { SunCountdown } from './SunCountdown.tsx'

// Sun from 10:00 to 14:00 in 5-minute steps.
const timeline: SunState[] = Array.from({ length: 288 }, (_, i) =>
  i >= 120 && i < 168 ? 'sun' : 'shade',
)

const fillWidth = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.sun-countdown-fill')?.style.width

describe('SunCountdown', () => {
  it('fills as the sun hours pass and is full when the sun goes', () => {
    const { container, rerender } = render(
      <SunCountdown timeline={timeline} minutes={600} />,
    )
    expect(fillWidth(container)).toBe('0%')
    rerender(<SunCountdown timeline={timeline} minutes={720} />)
    expect(fillWidth(container)).toBe('50%')
    expect(container.querySelector('.sun-countdown-knob')).toBeNull()
    rerender(<SunCountdown timeline={timeline} minutes={810} />)
    expect(fillWidth(container)).toBe('87.5%')
    expect(container.querySelector('.is-low')).not.toBeNull()
  })

  it('labels the sun spell and announces the time left', () => {
    render(<SunCountdown timeline={timeline} minutes={720} />)
    expect(screen.getByText('10:00')).toBeInTheDocument()
    expect(screen.getByText('14:00')).toBeInTheDocument()
    expect(screen.getByRole('meter')).toHaveAttribute(
      'aria-valuetext',
      'Quedan 2 h de sol, hasta las 14:00',
    )
  })

  it('shows nothing outside a sun spell', () => {
    const { container } = render(
      <SunCountdown timeline={timeline} minutes={900} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
