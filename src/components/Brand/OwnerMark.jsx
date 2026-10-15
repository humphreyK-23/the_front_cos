import { useState } from 'react'

// The owner's personal logo in the corner of the map and journey screens.
// owner-logo.png is a transparent, cropped copy of public/brand/mine.png.
export const OWNER_LOGO = '/brand/owner-logo.png'

export default function OwnerMark() {
  const [available, setAvailable] = useState(true)
  if (!available) return null
  return (
    <div className="owner-mark" aria-hidden="true">
      <img src={OWNER_LOGO} alt="" onError={() => setAvailable(false)} />
    </div>
  )
}
