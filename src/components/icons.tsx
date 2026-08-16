interface Props {
  size?: number
  className?: string
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const IcoPrinter = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M4.5 6V2.5h7V6" />
    <rect x="2" y="6" width="12" height="5.5" rx="1" />
    <path d="M4.5 9.5h7V14h-7z" fill="currentColor" stroke="none" opacity=".18" />
    <path d="M4.5 9.5h7V14h-7z" />
    <circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none" />
  </svg>
)

export const IcoNet = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M1.5 6.2a9 9 0 0 1 13 0M4 8.8a5.5 5.5 0 0 1 8 0" />
    <circle cx="8" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)

export const IcoUsb = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 14V3" />
    <path d="m6.2 4.8 1.8-2.3 1.8 2.3" fill="currentColor" stroke="none" />
    <path d="M8 9.5 5 8V6.4" />
    <path d="M8 7.5 11 6V4.6" />
    <circle cx="5" cy="5.8" r=".9" fill="currentColor" stroke="none" />
    <rect x="10" y="3.2" width="2" height="1.6" fill="currentColor" stroke="none" />
  </svg>
)

export const IcoEye = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z" />
    <circle cx="8" cy="8" r="1.7" />
  </svg>
)

export const IcoPause = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M6 3.5v9M10 3.5v9" />
  </svg>
)

export const IcoPlay = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M5 3.4 12.5 8 5 12.6z" />
  </svg>
)

export const IcoX = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
)

export const IcoPlus = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)

export const IcoAlert = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 2.3 15 13.7H1z" />
    <path d="M8 6.4v3.2" />
    <circle cx="8" cy="11.6" r=".7" fill="currentColor" stroke="none" />
  </svg>
)

export const IcoCheck = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="m3 8.4 3.2 3.1L13 4.9" />
  </svg>
)

export const IcoBell = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 7a4 4 0 0 1 8 0c0 3 1.2 4 1.2 4H2.8S4 10 4 7Z" />
    <path d="M6.6 13a1.6 1.6 0 0 0 2.8 0" />
  </svg>
)

export const IcoSun = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" />
  </svg>
)

export const IcoMoon = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M13 9.8A5.6 5.6 0 0 1 6.2 3a5.6 5.6 0 1 0 6.8 6.8Z" />
  </svg>
)

export const IcoSearch = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <circle cx="7.2" cy="7.2" r="4.2" />
    <path d="m10.4 10.4 3 3" />
  </svg>
)

export const IcoTrash = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 4.5h10M6.4 4.5V3h3.2v1.5M4.4 4.5l.6 8.2h6l.6-8.2" />
  </svg>
)

export const IcoWrench = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M10.4 2.4a3.4 3.4 0 0 0-3.3 5.7l-4.4 4.4 1.4 1.4 4.4-4.4a3.4 3.4 0 0 0 4.6-4.3l-2 2-1.7-.4-.4-1.7z" />
  </svg>
)

export const IcoPower = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 2.5v5" />
    <path d="M4.6 4.7a4.6 4.6 0 1 0 6.8 0" />
  </svg>
)

export const IcoRetry = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" />
    <path d="M13.4 2.6v3.1h-3.1" />
  </svg>
)

export const IcoTop = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 12.5V4M4.6 7.4 8 4l3.4 3.4M3.5 2.2h9" />
  </svg>
)

export const IcoChevron = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="m6 3.5 5 4.5-5 4.5" />
  </svg>
)

export const IcoExternal = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M9 3h4v4M13 3 7.6 8.4" />
    <path d="M12 9.6V13H3V4h3.5" />
  </svg>
)

export const IcoGrip = ({ size = 14 }: Props) => (
  <svg {...base(size)} strokeWidth={1.2}>
    <circle cx="6" cy="4" r=".9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="4" r=".9" fill="currentColor" stroke="none" />
    <circle cx="6" cy="8" r=".9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="8" r=".9" fill="currentColor" stroke="none" />
    <circle cx="6" cy="12" r=".9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="12" r=".9" fill="currentColor" stroke="none" />
  </svg>
)

export const IcoBoard = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <rect x="2" y="3" width="3.6" height="10" rx="1" />
    <rect x="6.8" y="3" width="3.6" height="10" rx="1" />
    <rect x="11.6" y="3" width="3.6" height="10" rx="1" />
  </svg>
)

export const IcoGrid = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <rect x="2.2" y="2.6" width="5.2" height="4.6" rx="1" />
    <rect x="8.6" y="2.6" width="5.2" height="4.6" rx="1" />
    <rect x="2.2" y="8.8" width="5.2" height="4.6" rx="1" />
    <rect x="8.6" y="8.8" width="5.2" height="4.6" rx="1" />
  </svg>
)

export const IcoMinus = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M3.5 8h9" />
  </svg>
)

export const IcoChevronDown = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="m3.5 6 4.5 4.5L12.5 6" />
  </svg>
)

export const IcoList = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
    <circle cx="3" cy="4" r=".9" fill="currentColor" stroke="none" />
    <circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none" />
    <circle cx="3" cy="12" r=".9" fill="currentColor" stroke="none" />
  </svg>
)

export const IcoRail = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M6.2 3v10" />
  </svg>
)

export const IcoMin = ({ size = 10 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 10 10">
    <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
  </svg>
)

export const IcoMax = ({ size = 10 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 10 10">
    <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
)

export const IcoClose = ({ size = 10 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 10 10">
    <path d="m0 0 10 10M10 0 0 10" stroke="currentColor" strokeWidth="1" />
  </svg>
)
