import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { getFloorLabel } from '../../utils/floors'
import { maneuverOf } from '../../utils/journey'
import ManeuverIcon from './ManeuverIcon'

// Footer sheet listing the route's steps before the journey starts. Tapping a
// step shows its floor on the map.
export default function RouteSummaryDrawer({ routeData, distanceLabel, onStartJourney, onSelectFloor }) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!routeData || !routeData.path || routeData.path.length < 2) return null
  const instructions = routeData.instructions ?? []

  return (
    <aside className="route-sheet">
      <div className="route-sheet-header">
        <button type="button" className="route-sheet-toggle" onClick={() => setIsExpanded(!isExpanded)} aria-expanded={isExpanded}>
          <span className="route-sheet-badge">{instructions.length} steps</span>
          <span>
            <small>Route summary</small>
            <strong>{distanceLabel && distanceLabel !== '—' ? `${distanceLabel} · Directions ready` : 'Directions ready'}</strong>
          </span>
          {isExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
        {onStartJourney ? (
          <button type="button" className="route-sheet-start" onClick={onStartJourney}>
            Start
          </button>
        ) : null}
      </div>

      {isExpanded ? (
        <ol className="route-sheet-steps">
          {instructions.length > 0 ? (
            instructions.map((step, index) => (
              <li key={index}>
                <button type="button" onClick={() => onSelectFloor?.(step.floor)} title={`Show ${getFloorLabel(step.floor)} on the map`}>
                  <span className="route-sheet-icon">
                    <ManeuverIcon maneuver={maneuverOf(step)} size={18} />
                  </span>
                  <span>
                    <strong>{step.text}</strong>
                    <small>
                      {getFloorLabel(step.floor)}
                      {step.distance_m > 0 ? ` · ${step.distance_m.toFixed(1)} m` : ''}
                    </small>
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="route-sheet-empty">Follow the green line on the floor map to reach your destination.</li>
          )}
        </ol>
      ) : null}
    </aside>
  )
}
