/**
 * How the current time shows on the bar, by how far the thumb is from it:
 * nothing within 15 min (the thumb would cover it), the dot alone up to
 * 30 min (the "Ahora" label would touch the thumb), then dot and label.
 */
export function nowMarker(
  now: number,
  minutes: number,
): 'none' | 'dot' | 'label' {
  const away = Math.abs(now - minutes)
  if (away <= 15) return 'none'
  return away <= 30 ? 'dot' : 'label'
}
