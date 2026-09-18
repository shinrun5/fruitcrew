const INK = '#3A2B4D'

export function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" fill="#FFFFFF" />
    </svg>
  )
}

export function StarBadgeIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3 L14.5 9.5 L21 10 L16 14.5 L17.5 21 L12 17.5 L6.5 21 L8 14.5 L3 10 L9.5 9.5 Z"
        fill="#FFC94D"
        stroke={INK}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

// stroke icons — inherit color from the parent's text color
function stroke(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
}

export function CalendarIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...stroke(size)}>
      <rect x={3} y={4.5} width={18} height={16} rx={2.5} />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </svg>
  )
}

export function ClockIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...stroke(size)}>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 7v5.2l3.4 2" />
    </svg>
  )
}

export function UserIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...stroke(size)}>
      <circle cx={12} cy={8} r={4} />
      <path d="M4.5 20.5c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6" />
    </svg>
  )
}

export function SwapIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...stroke(size)}>
      <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
    </svg>
  )
}

export function WarningIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 L22 20 H2 Z" fill="#FF6F61" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      <rect x={11} y={9} width={2} height={6} rx={1} fill={INK} />
      <circle cx={12} cy={17.5} r={1.3} fill={INK} />
    </svg>
  )
}

export function BellIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...stroke(size)}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function ChatIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...stroke(size)}>
      <path d="M4 5.5h16v11H9l-4 4v-4H4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  )
}

export function NoteIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...stroke(size)}>
      <path d="M6 3h9l5 5v13H6z" />
      <path d="M14 3v6h6M9 13h7M9 16.5h5" />
    </svg>
  )
}

export function ChecklistIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...stroke(size)}>
      <path d="M9 5h11M9 12h11M9 19h11" />
      <path d="M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2" />
    </svg>
  )
}
