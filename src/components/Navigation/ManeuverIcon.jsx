// Turn arrows for the direction bar, drawn inline so they scale and take the
// bar's colour (currentColor).
const PATHS = {
  left: <path d="M17 20v-6a4 4 0 0 0-4-4H6m0 0 4-4m-4 4 4 4" />,
  right: <path d="M7 20v-6a4 4 0 0 1 4-4h7m0 0-4-4m4 4-4 4" />,
  straight: <path d="M12 20V5m0 0-5 5m5-5 5 5" />,
  up: (
    <>
      <path d="M3 20h4v-4h4v-4h4V8h4" />
      <path d="M14 4h5v5" />
    </>
  ),
  down: (
    <>
      <path d="M3 4h4v4h4v4h4v4h4" />
      <path d="M19 13v6h-6" />
    </>
  ),
  arrive: (
    <>
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  locating: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="7" />
    </>
  ),
}

function iconFor(maneuver) {
  if (maneuver === 'left' || maneuver === 'right' || maneuver === 'arrive' || maneuver === 'locating') return maneuver
  if (/_up$/.test(maneuver ?? '')) return 'up'
  if (/_down$/.test(maneuver ?? '')) return 'down'
  return 'straight'
}

export default function ManeuverIcon({ maneuver, size = 34 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[iconFor(maneuver)]}
    </svg>
  )
}
