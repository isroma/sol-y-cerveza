import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

/**
 * Sun rising behind a pint: the app's mark. Same drawing as public/favicon.svg
 * (the source for every PNG icon). All eight rays are drawn; the pint hides
 * the right and lower ones.
 */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="logo-sun" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#FFD866" />
          <stop offset="1" stopColor="#FFB020" />
        </radialGradient>
        <linearGradient id="logo-beer" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFC53D" stopOpacity="0.2" />
          <stop offset="1" stopColor="#E8890C" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path
        d="M19.00 5.50L19.00 2.00M26.42 8.58L28.90 6.10M29.50 16.00L33.00 16.00M26.42 23.42L28.90 25.90M19.00 26.50L19.00 30.00M11.58 23.42L9.10 25.90M8.50 16.00L5.00 16.00M11.58 8.58L9.10 6.10"
        stroke="#F5A623"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="19" cy="16" r="7.5" fill="url(#logo-sun)" />
      <rect x="17" y="19" width="20" height="25" rx="4" fill="#FFB020" />
      <rect
        x="17"
        y="19"
        width="20"
        height="25"
        rx="4"
        fill="url(#logo-beer)"
      />
      <path
        d="M37 24h3.5a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-3.5 3.5H37"
        fill="none"
        stroke="#FFB020"
        strokeWidth="3"
      />
      <path
        d="M15.5 20.5c0-3.6 3-5.5 6-4.5 1.2-2.5 5-3 7-1 2-1.5 5.5-.8 6.5 1.6 2.4.2 3.6 2.2 3 4.4z"
        fill="#FFF8E7"
        stroke="#F3E2BF"
      />
      <path
        d="M23 26v13M30 26v13"
        stroke="#FFE08A"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
)

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Icon>
)

/** Half-filled sun with its right rays faded: "sol parcial". */
export const SunPartialIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 8a4 4 0 0 0 0 8z" fill="currentColor" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M2.5 12h2M4.6 19.4 6 18" />
    <path d="M18 18l1.4 1.4M19.5 12h2M18 6l1.4-1.4" opacity="0.55" />
  </Icon>
)

/** Sun behind the horizon line: "sol en breve". */
export const SunSoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 16a4.5 4.5 0 0 1 9 0" />
    <path d="M3 16h18M12 6.5v2.5M5.6 9.6l1.7 1.7M18.4 9.6l-1.7 1.7M3 20h18" />
  </Icon>
)

/** Half sun on the horizon with an arrow up. */
export const SunriseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 18a5 5 0 0 1 10 0M3 18h18M12 3v6M9 6l3-3 3 3" />
  </Icon>
)

/** Half sun on the horizon with an arrow down. */
export const SunsetIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 18a5 5 0 0 1 10 0M3 18h18M12 3v6M9 6l3 3 3-3" />
  </Icon>
)

export const SunOffIcon = (p: IconProps) => (
  <Icon {...p} strokeDasharray="0">
    <circle cx="12" cy="12" r="4" />
    <path
      d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"
      opacity="0.55"
    />
  </Icon>
)

export const BeerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 8h10v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
    <path d="M16 11h1.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H16" />
    <path d="M6 8c0-2 1.5-3 3-2.5C9.7 4 12 3.7 13 5c1.5-.7 3 .4 3 3" />
    <path d="M9.5 12v6M12.5 12v6" />
  </Icon>
)

/** Table under a parasol. */
export const TerraceIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 9.5 12 4l8.5 5.5z" />
    <path d="M12 9.5V21M7 15h10M8.5 15 7 21M15.5 15l1.5 6" />
  </Icon>
)

/** Box with an arrow leaving it upwards: share a link. */
export const ShareIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5v11M8 7.5l4-4 4 4" />
    <path d="M8.5 10.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-1.5" />
  </Icon>
)

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Icon>
)

export const LocateIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 3.5 3.5 10.6l7 2.4 2.4 7z" />
  </Icon>
)

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
)

export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
)

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
)

/** Compass needle: the filled half points north. */
export const CompassIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 15.5 12h-7z" fill="currentColor" />
    <path d="M12 20.5 8.5 12h7z" />
  </Icon>
)

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Icon>
)
