import ManeuverIcon from './ManeuverIcon'
import { getFloorLabel } from '../../utils/floors'
import { isFloorChange, isTurn } from '../../utils/journey'

const roundDistance = (metres) => (metres >= 20 ? Math.round(metres / 5) * 5 : Math.max(1, Math.round(metres)))

// What the bar says for the next step.
function describe(step, distance, destinationName) {
  if (!step) return { maneuver: 'straight', title: 'Follow the route', detail: '' }
  const near = distance <= 4
  const place = step.node?.name ? `at ${step.node.name}` : ''
  if (isTurn(step.maneuver)) {
    return {
      maneuver: step.maneuver,
      title: near ? `Turn ${step.maneuver} now` : `In ${roundDistance(distance)} m, turn ${step.maneuver}`,
      detail: place,
    }
  }
  if (isFloorChange(step.maneuver)) {
    const [kind, direction] = step.maneuver.split('_')
    const how = kind === 'elevator' ? 'the elevator' : 'the stairs'
    return {
      maneuver: step.maneuver,
      title: near ? `Take ${how} ${direction}` : `In ${roundDistance(distance)} m, take ${how} ${direction}`,
      detail: place,
    }
  }
  if (step.maneuver === 'arrive') {
    return {
      maneuver: 'arrive',
      title: near ? `${destinationName} is here` : `In ${roundDistance(distance)} m, arrive`,
      detail: near ? '' : destinationName,
    }
  }
  return { maneuver: 'straight', title: `Continue straight for ${roundDistance(distance)} m`, detail: place }
}

/**
 * The journey's top bar (like a satnav): the next maneuver with its distance,
 * what is left to walk, and the actions that only the user can confirm.
 */
export default function DirectionBar({
  snapshot,
  step,
  destinationName,
  connection,
  onExit,
  onReachedFloor,
  onReachedEnd,
}) {
  if (!snapshot) return null

  let content
  let action = null
  if (snapshot.status === 'arrived') {
    content = { maneuver: 'arrive', title: 'You have arrived', detail: destinationName }
    action = (
      <button type="button" className="direction-action primary" onClick={onExit}>
        Done
      </button>
    )
  } else if (snapshot.status === 'at_stairs') {
    const direction = snapshot.nextFloor > snapshot.floor ? 'up' : 'down'
    content = {
      maneuver: `stairs_${direction}`,
      title: `Take the stairs ${direction} to ${getFloorLabel(snapshot.nextFloor)}`,
      detail: 'Tap below once you are there',
    }
    action = (
      <button type="button" className="direction-action primary" onClick={onReachedFloor}>
        I'm on {getFloorLabel(snapshot.nextFloor)} now
      </button>
    )
  } else if (snapshot.calibrating) {
    content = { maneuver: 'locating', title: 'Locking onto your position…', detail: 'Stand still for a moment' }
  } else {
    content = describe(step, step ? step.s - snapshot.travelledM : 0, destinationName)
    action = (
      <button type="button" className="direction-action" onClick={onReachedEnd}>
        {snapshot.nextFloor !== null ? "I'm at the stairs" : "I've arrived"}
      </button>
    )
  }

  return (
    <section className="direction-bar" aria-live="polite">
      <div className="direction-main">
        <div className="direction-icon">
          <ManeuverIcon maneuver={content.maneuver} />
        </div>
        <div className="direction-text">
          <p className="direction-title">{content.title}</p>
          {content.detail ? <p className="direction-detail">{content.detail}</p> : null}
        </div>
        <button type="button" className="direction-exit" onClick={onExit}>
          End journey
        </button>
      </div>
      <div className="direction-meta">
        <img className="direction-logo" src="/brand/logo.svg" alt="COS Indoor Navigation" width="22" height="22" />
        <span className="direction-remaining">
          <strong>{Math.round(snapshot.remainingM)} m</strong> to go
        </span>
        <span className="direction-floor">{getFloorLabel(snapshot.floor)}</span>
        <span className={`direction-connection ${connection === 'live' ? 'live' : ''}`}>
          {connection === 'live' ? 'Live' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
        </span>
        {action}
      </div>
    </section>
  )
}
