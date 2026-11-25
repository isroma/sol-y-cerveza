import type { SunCategory } from '../sun/venueStatus.ts'
import { CATEGORY_COLORS } from './categoryStyle.ts'
import { SunIcon, SunOffIcon, SunSoonIcon, TerraceIcon } from './icons.tsx'

export function CategoryIcon({
  category,
  size = 20,
}: {
  category: SunCategory
  size?: number
}) {
  const style = { color: CATEGORY_COLORS[category] }
  if (category === 'sun') return <SunIcon size={size} style={style} />
  if (category === 'soon') return <SunSoonIcon size={size} style={style} />
  if (category === 'nosun') return <SunOffIcon size={size} style={style} />
  return <TerraceIcon size={size} style={style} />
}
