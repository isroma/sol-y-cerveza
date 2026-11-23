import type { SunCategory } from '../sun/venueStatus.ts'

const AWNINGS = ['#E4572E', '#2E86AB', '#3BB273', '#7768AE', '#E1A100']

function pick(id: string): string {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum = (sum * 31 + id.charCodeAt(i)) >>> 0
  return AWNINGS[sum % AWNINGS.length] ?? '#E4572E'
}

/** A drawn terrace standing in for a photo (we have no open photos). */
export function TerraceIllustration({
  id,
  category,
}: {
  id: string
  category: SunCategory
}) {
  const sunny = category === 'sun'
  const awning = pick(id)
  return (
    <svg
      className="illustration"
      viewBox="0 0 120 120"
      role="img"
      aria-label="Imagen ilustrativa de una terraza"
    >
      <defs>
        <linearGradient id={`sky-${category}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sunny ? '#FFD98A' : '#C9D6E3'} />
          <stop offset="1" stopColor={sunny ? '#FFF3D6' : '#EEF2F6'} />
        </linearGradient>
      </defs>
      <rect width="120" height="120" fill={`url(#sky-${category})`} />
      {sunny && <circle cx="96" cy="22" r="11" fill="#FFC53D" />}
      <rect x="6" y="28" width="70" height="66" fill="#E9D8BD" />
      <rect x="14" y="40" width="14" height="20" fill="#9C7B5B" />
      <rect x="40" y="40" width="14" height="20" fill="#9C7B5B" />
      <path d="M4 62h76l-6 10H10z" fill={awning} />
      <path
        d="M4 62h76"
        stroke="#fff"
        strokeWidth="1.5"
        strokeDasharray="6 6"
      />
      <rect
        x="0"
        y="94"
        width="120"
        height="26"
        fill={sunny ? '#E8D3B0' : '#CBD2DA'}
      />
      <path d="M62 66 90 56l28 10z" fill="#F4F1EA" stroke="#D9D2C2" />
      <path d="M90 66v30" stroke="#8A7A66" strokeWidth="2" />
      <ellipse cx="90" cy="96" rx="15" ry="3.5" fill="#6B5B4A" opacity="0.25" />
      <path
        d="M78 92h24M82 92l-2 12M98 92l2 12"
        stroke="#6B5B4A"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M18 98h20M22 98l-2 10M34 98l2 10"
        stroke="#6B5B4A"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="28" cy="94" r="2.5" fill="#FFC53D" />
      <circle cx="94" cy="88" r="2.5" fill="#FFC53D" />
    </svg>
  )
}
