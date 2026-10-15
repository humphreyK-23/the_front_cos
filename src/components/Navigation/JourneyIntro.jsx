import { Play } from 'lucide-react'
import { getFloorLabel, FLOORS } from '../../utils/floors'
import { getRoomName } from '../../utils/rooms'
import { roomCodeOf } from '../../utils/journey'

const floorName = (floor) => FLOORS[String(floor)]?.label?.replace(/\s*\(.*\)$/, '') ?? getFloorLabel(floor)

const describeRoom = (room) => {
  const name = getRoomName(room)
  const code = room?.room_code || roomCodeOf(name)
  return code && !name.toUpperCase().includes(code) ? `${name} (${code})` : name
}

/**
 * Shown at the top once directions are ready, before the journey starts:
 * where the user is, where they are going, and how.
 */
export default function JourneyIntro({ origin, destination, route, onStart, onChange }) {
  if (!route) return null
  const metres = route.total_distance_m ?? 0
  const floorChanges = (route.path ?? []).filter((node) => node.transition)
  const lastChange = floorChanges[floorChanges.length - 1]
  const startFloor = route.path?.[0]?.floor ?? origin?.floor
  let via = ''
  if (lastChange) {
    const direction = lastChange.transition.target_floor > startFloor ? 'up' : 'down'
    const how = lastChange.transition.kind === 'elevator' ? 'the elevator' : 'the stairs'
    via = `, taking ${how} ${direction} to ${floorName(lastChange.transition.target_floor)}`
  }

  return (
    <section className="journey-intro">
      <p className="eyebrow">Ready when you are</p>
      <p className="journey-intro-text">
        You are at <strong>{describeRoom(origin)}</strong> on the {floorName(startFloor)}.{' '}
        <strong>{describeRoom(destination)}</strong> is {Math.round(metres)} m away{via}.
      </p>
      <p className="journey-intro-hint">Follow the green line. We will check in with you at the stairs and at turns.</p>
      <div className="journey-intro-actions">
        <button type="button" className="journey-button start-journey" onClick={onStart}>
          <Play size={16} /> Start Journey
        </button>
        <button type="button" className="journey-intro-change" onClick={onChange}>
          Change
        </button>
      </div>
    </section>
  )
}
