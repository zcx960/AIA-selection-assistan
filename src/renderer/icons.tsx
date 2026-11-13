import React from 'react'

type IconProps = {
  size?: number
  strokeWidth?: number
}

function baseProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }
}

function CircleHelp({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.25a2.7 2.7 0 0 1 5 1.4c0 1.7-1.9 2.45-2.5 3.35" />
      <circle cx="12" cy="16.9" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CopyIcon({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function ImageIcon({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  )
}

function FlaskConical({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M10 3h4" />
      <path d="M10 3v4.5l-5.8 9.5A2 2 0 0 0 5.9 20h12.2a2 2 0 0 0 1.7-3l-5.8-9.5V3" />
      <path d="M8 13h8" />
    </svg>
  )
}

function Languages({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M4 6h7" />
      <path d="M7.5 4v2a10 10 0 0 1-3 7" />
      <path d="M4.5 13c1.5-.2 3-.9 4.5-2.1" />
      <path d="M13 6h7" />
      <path d="M16.5 4v2a10 10 0 0 1-3 7" />
      <path d="M13.5 13c1.5-.2 3-.9 4.5-2.1" />
    </svg>
  )
}

function Laptop({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <rect x="5" y="6" width="14" height="10" rx="2" />
      <path d="M3 18h18" />
    </svg>
  )
}

function Moon({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M20 14.5A7.5 7.5 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" />
    </svg>
  )
}

function Pin({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="m15 4 5 5-3 1-3 6-1.5-1.5-6 3 3-6L8 8l7-4Z" />
    </svg>
  )
}

function PinOff({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="m15 4 5 5-3 1-1.2 2.3" />
      <path d="m11.7 12.3-1.2 2.2L8 8l7-4" />
      <path d="m3 21 6-6" />
    </svg>
  )
}

function ScanText({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M7 4H5a2 2 0 0 0-2 2v2" />
      <path d="M17 4h2a2 2 0 0 1 2 2v2" />
      <path d="M7 20H5a2 2 0 0 1-2-2v-2" />
      <path d="M17 20h2a2 2 0 0 0 2-2v-2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </svg>
  )
}

function SearchIcon({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

function Sparkles({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4L12 3Z" />
      <path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" />
      <path d="m19 13 .5 1.3L21 15l-1.5.7L19 17l-.5-1.3L17 15l1.5-.7L19 13Z" />
    </svg>
  )
}

function Square({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  )
}

function Sun({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2" />
      <path d="M12 19.3v2.2" />
      <path d="m4.8 4.8 1.6 1.6" />
      <path d="m17.6 17.6 1.6 1.6" />
      <path d="M2.5 12h2.2" />
      <path d="M19.3 12h2.2" />
      <path d="m4.8 19.2 1.6-1.6" />
      <path d="m17.6 6.4 1.6-1.6" />
    </svg>
  )
}

function Trash2({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M4 7h16" />
      <path d="M10 3h4" />
      <path d="M6.5 7 7.3 19a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  )
}

function XIcon({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  )
}

function Download({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 19h14" />
    </svg>
  )
}

function ArrowUp({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 5v14" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  )
}

function Pencil({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  )
}

function ArrowUpRight({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  )
}

function Undo2({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  )
}

function MousePointer({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="m4 4 7 16 2.2-7.2L20 10.5 4 4Z" />
    </svg>
  )
}

function Power({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 3v9" />
      <path d="M6.4 7.4a8 8 0 1 0 11.2 0" />
    </svg>
  )
}

function BookOpen({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2Z" />
      <path d="M12 6.5v12" />
    </svg>
  )
}

function Volume2({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M16 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5.5a9 9 0 0 1 0 13" />
    </svg>
  )
}

function Quote({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
      <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
    </svg>
  )
}

function MessageCircle({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  )
}

function Minus({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...baseProps(size)} strokeWidth={strokeWidth}>
      <path d="M5 12h14" />
    </svg>
  )
}

const icons: Record<string, (props: IconProps) => React.JSX.Element> = {
  video: ({ size = 16, strokeWidth = 2 }) => <svg {...baseProps(size)} strokeWidth={strokeWidth}><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3Z" /></svg>,
  'circle-help': CircleHelp,
  'arrow-up': ArrowUp,
  'arrow-up-right': ArrowUpRight,
  'book-open': BookOpen,
  power: Power,
  copy: CopyIcon,
  download: Download,
  image: ImageIcon,
  'flask-conical': FlaskConical,
  languages: Languages,
  laptop: Laptop,
  moon: Moon,
  'mouse-pointer': MousePointer,
  pencil: Pencil,
  pin: Pin,
  'pin-off': PinOff,
  quote: Quote,
  'message-circle': MessageCircle,
  minus: Minus,
  'scan-text': ScanText,
  search: SearchIcon,
  sparkles: Sparkles,
  square: Square,
  sun: Sun,
  'trash-2': Trash2,
  'undo-2': Undo2,
  'volume-2': Volume2,
  x: XIcon
}

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const Component = icons[name] ?? Sparkles
  return <Component size={size} strokeWidth={2} />
}
