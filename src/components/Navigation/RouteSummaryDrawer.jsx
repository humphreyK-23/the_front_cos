import { useState } from 'react'
import { getFloorLabel } from '../../utils/floors'

export default function RouteSummaryDrawer({
  routeData,
  distanceLabel,
  navigationState = 'idle',
  onStartJourney,
  onSelectFloor,
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 1. Hide footer completely until a route is loaded
  if (!routeData || !routeData.path || routeData.path.length < 2) {
    return null
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[92%] max-w-lg z-drawer transition-all duration-300 ease-in-out">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        
        {/* Header Bar (Toggle Trigger) */}
        <div 
          className="p-4 flex items-center justify-between cursor-pointer select-none bg-slate-50/80 hover:bg-slate-100/80 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-xl font-bold text-xs">
              NAV
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Route Summary
              </p>
              <h3 className="text-sm font-semibold text-slate-800">
                {navigationState === 'navigating'
                  ? `${distanceLabel} to go`
                  : distanceLabel && distanceLabel !== '—'
                    ? `${distanceLabel} · Directions ready`
                    : 'Directions ready'}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Start Journey Button (hidden once the journey is under way) */}
            {navigationState !== 'navigating' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation() // Prevents expanding/collapsing when clicking Start
                onStartJourney?.()
              }}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-md transition-all"
            >
              Start
            </button>
            )}

            {/* Expand / Collapse Toggle Arrow */}
            <button 
              type="button"
              className="p-1 text-slate-500 hover:text-slate-800 rounded-lg text-xs font-bold"
            >
              {isExpanded ? '▼' : '▲'}
            </button>
          </div>
        </div>

        {/* Expandable Turn-by-Turn Panel */}
        {isExpanded && (
          <div className="p-4 border-t border-slate-100 max-h-56 overflow-y-auto space-y-2.5">
            {routeData.instructions && routeData.instructions.length > 0 ? (
              routeData.instructions.map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-2 rounded-xl bg-slate-50 cursor-pointer hover:bg-slate-100"
                  onClick={() => onSelectFloor?.(step.floor)}
                  title={`Show ${getFloorLabel(step.floor)} on the map`}
                >
                  <span className="w-5 h-5 flex items-center justify-center bg-blue-600 text-white text-[10px] font-bold rounded-full shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="text-xs">
                    <p className="font-medium text-slate-700">{step.text}</p>
                    <p className="text-[10px] text-slate-400">
                      {getFloorLabel(step.floor)}
                      {step.distance_m > 0 ? ` · ${step.distance_m.toFixed(1)} m` : ''}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500 text-center py-2">
                Follow the blue path on the floor map to reach your destination.
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  )
}