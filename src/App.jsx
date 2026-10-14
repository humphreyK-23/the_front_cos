import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Crosshair, Search } from 'lucide-react'
import './App.css'
import './journey.css'
import './glass.css'
import SearchBar from './components/Search/SearchBar'
import FloorControls from './components/Map/FloorControls'
import IndoorMap from './components/Map/IndoorMap'
import { searchRooms, getRoute, getNearbyRooms } from './api/navigation'
import { getBestLocationFix, useJourneySocket } from './api/journeySocket'
import { useRouteTracker } from './api/routeTracker'
import { FLOORS, getFloorLabel, getFloorValue, COS_BOUNDS, COS_FLOOR_CORNERS } from './utils/floors' 
import { getRoomName } from './utils/rooms'
import RouteSummaryDrawer from './components/Navigation/RouteSummaryDrawer'
import DirectionBar from './components/Navigation/DirectionBar'
import JourneyIntro from './components/Navigation/JourneyIntro'
import LandmarkPrompt from './components/Navigation/LandmarkPrompt'
import { activeCheckpoint, buildCheckpoints, buildSteps, nearbyLandmarks, nextStep } from './utils/journey'

// Build config dynamically from object entries instead of .map
const defaultFloorPlanConfig = Object.fromEntries(
  Object.entries(FLOORS).map(([key, floor]) => [
    key,
    { url: floor.url || floor.image, bounds: floor.bounds || COS_BOUNDS || COS_FLOOR_CORNERS, corners: floor.corners || COS_FLOOR_CORNERS },
  ])
)

function App() {
  const [originQuery, setOriginQuery] = useState('')
  const [destinationQuery, setDestinationQuery] = useState('')
  const [originResults, setOriginResults] = useState([])
  const [destinationResults, setDestinationResults] = useState([])
  const [selectedOrigin, setSelectedOrigin] = useState(null)
  const [selectedDestination, setSelectedDestination] = useState(null)
  const [routeData, setRouteData] = useState(null)
  const [activeFloor, setActiveFloor] = useState(0)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [mapMode, setMapMode] = useState('hybrid')
  const [navigationState, setNavigationState] = useState('idle')
  const [journeyNotice, setJourneyNotice] = useState('')
  // On phones the search starts folded into one tappable bar and opens full
  // screen; on larger screens it is a floating panel.
  const [panelCollapsed, setPanelCollapsed] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches,
  )
  const [locating, setLocating] = useState(false)
  const [locationNote, setLocationNote] = useState('')
  const [nearbyOrigins, setNearbyOrigins] = useState([])
  // Nearest room found from GPS, waiting for "Is this your current location?"
  const [pendingOrigin, setPendingOrigin] = useState(null)
  // "My location" first asks which floor the user is on: GPS cannot tell.
  const [askingFloor, setAskingFloor] = useState(false)
  // The route as planned when the journey started; the tracker follows it.
  const [lockedPolyline, setLockedPolyline] = useState(null)
  // Landmark questions already answered (or skipped) on this journey.
  const [answeredCheckpoints, setAnsweredCheckpoints] = useState(() => new Set())
  // Follow-up screens of a landmark question ("what do you see?", feedback).
  const [promptOverride, setPromptOverride] = useState(null)
  const [startToast, setStartToast] = useState(false)
  const timers = useRef([])

  // "My location", after the user has said which floor they are on: take the
  // best GPS fix available, then offer the closest rooms on that floor.
  // Suggestions are limited to a radius based on the fix's accuracy, so a
  // ±100 m fix does not propose rooms from the far side of the floor.
  const handleUseMyLocation = async (floor) => {
    setAskingFloor(false)
    setActiveFloor(floor)
    setLocating(true)
    setPendingOrigin(null)
    setLocationNote(`Finding your location on ${getFloorLabel(floor)}…`)
    setNearbyOrigins([])
    try {
      const fix = await getBestLocationFix()
      const radius = Math.min(40, Math.max(15, fix.accuracy))
      const rooms = await getNearbyRooms(fix.lat, fix.lng, floor, 5, radius)
      if (!rooms.length) {
        setLocationNote(`No rooms found on ${getFloorLabel(floor)}.`)
        return
      }
      const [closest, ...others] = rooms
      setPendingOrigin({ room: closest, accuracy: Math.round(fix.accuracy), floor })
      setNearbyOrigins(others)
      setLocationNote('')
    } catch (error) {
      setLocationNote(error?.response?.data?.error || error?.message || 'Unable to find your location.')
    } finally {
      setLocating(false)
    }
  }

  // "Yes, this is my location": lock it in as the start of the route.
  const confirmPendingOrigin = (room = pendingOrigin?.room) => {
    if (!room) return
    setSelectedOrigin(room)
    setOriginQuery(getRoomName(room))
    setOriginResults([])
    setNearbyOrigins([])
    setPendingOrigin(null)
    setLocationNote(`Start locked to ${getRoomName(room)} on ${getFloorLabel(room.floor)}.`)
    resetPlannedRoute()
  }

  const isNavigating = navigationState === 'navigating'

  // The marker is locked to the route: GPS only moves it forward along the
  // current floor's stretch, and floor changes are confirmed at the stairs.
  const tracker = useRouteTracker({ enabled: isNavigating, polyline: lockedPolyline })
  const trackedPosition = tracker.snapshot?.position ?? null
  const locationError = tracker.error
  const activePathNodeIds = useMemo(
    () => routeData?.path?.map((node) => node.node_id) ?? [],
    [routeData],
  )

  // The journey socket keeps the live session; while the route is locked its
  // route updates are not applied, only its notices.
  const handleJourneyMessage = useCallback((message) => {
    if (message.type === 'error' && message.error) setJourneyNotice(message.error)
  }, [])

  const journeyStatus = useJourneySocket({
    enabled: isNavigating,
    destinationNodeId: selectedDestination?.node_id,
    activePathNodeIds,
    position: trackedPosition,
    onMessage: handleJourneyMessage,
  })

  const handleReachedFloor = () => {
    const nextFloor = tracker.snapshot?.nextFloor
    tracker.confirmFloorChange()
    if (nextFloor !== null && nextFloor !== undefined) setActiveFloor(nextFloor)
  }

  const later = (callback, ms) => {
    timers.current.push(setTimeout(callback, ms))
  }
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  // Turn-by-turn: every instruction placed on the locked route, the next one
  // ahead of the user, and the landmark questions along the way.
  const steps = useMemo(
    () => (isNavigating ? buildSteps(routeData, tracker.geometry) : []),
    [isNavigating, routeData, tracker.geometry],
  )
  const checkpoints = useMemo(
    () => (isNavigating ? buildCheckpoints(routeData, steps, tracker.geometry) : []),
    [isNavigating, routeData, steps, tracker.geometry],
  )
  const upcomingStep = tracker.snapshot ? nextStep(steps, tracker.snapshot.travelledM) : null
  const pendingCheckpoint = activeCheckpoint(checkpoints, answeredCheckpoints, tracker.snapshot)
  const prompt = promptOverride ?? (pendingCheckpoint ? { stage: 'ask', checkpoint: pendingCheckpoint } : null)

  const showFeedback = (message) => {
    setPromptOverride({ stage: 'feedback', message })
    later(() => setPromptOverride((current) => (current?.stage === 'feedback' ? null : current)), 2500)
  }

  const markAnswered = (checkpoint) =>
    setAnsweredCheckpoints((answered) => new Set(answered).add(checkpoint.id))

  const handleLandmarkYes = () => {
    const checkpoint = prompt?.checkpoint
    if (!checkpoint) return
    // A confirmed landmark is an exact position: snap to it.
    if (checkpoint.kind === 'turn' && Number.isFinite(checkpoint.landmarkS)) tracker.snapTo(checkpoint.landmarkS)
    markAnswered(checkpoint)
    showFeedback('Great, you are on course.')
  }

  const handleLandmarkNo = () => {
    const checkpoint = prompt?.checkpoint
    if (!checkpoint) return
    markAnswered(checkpoint)
    if (checkpoint.kind === 'stairs') {
      // The tracker thought the user was at the stairs; they are not yet.
      tracker.backOff(6)
      showFeedback('Keep following the line, the stairs are just ahead.')
      return
    }
    const options = nearbyLandmarks(routeData, tracker.geometry, tracker.snapshot, checkpoint.landmark)
    setPromptOverride(options.length ? { stage: 'alternatives', checkpoint, options } : { stage: 'lost', checkpoint })
  }

  const handleLandmarkPick = (option) => {
    tracker.snapTo(option.s)
    showFeedback(`Thanks, your position is updated to ${option.label}.`)
  }

  // Keep the screen on while navigating: a locked phone stops reporting location.
  useEffect(() => {
    if (!isNavigating || !('wakeLock' in navigator)) return undefined
    let lock = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (cancelled) sentinel.release()
          else lock = sentinel
        })
        .catch(() => {})
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      lock?.release().catch(() => {})
    }
  }, [isNavigating])

  // What the map shows: during a journey, only what is left to walk.
  const displayRoute = useMemo(
    () =>
      isNavigating && tracker.snapshot
        ? { ...routeData, polyline: tracker.snapshot.remainingPolyline }
        : routeData,
    [isNavigating, routeData, tracker.snapshot],
  )

  const resetPlannedRoute = () => {
    setRouteData(null)
    setNavigationState('idle')
    setRouteError('')
  }

  const handleRoomSearch = async (query, target) => {
    const cleanQuery = query.trim()

    if (!cleanQuery) {
      if (target === 'origin') setOriginResults([])
      if (target === 'destination') setDestinationResults([])
      return
    }

    try {
      const rooms = await searchRooms(cleanQuery)
      if (target === 'origin') setOriginResults(rooms)
      if (target === 'destination') setDestinationResults(rooms)
    } catch (error) {
      if (target === 'origin') setOriginResults([])
      if (target === 'destination') setDestinationResults([])
    }
  }

  const handleGetDirections = async () => {
    if (!selectedOrigin || !selectedDestination) {
      setRouteError('Kindly select your current location and a destination room.')
      return
    }

    setRouteLoading(true)
    setRouteError('')
    setRouteData(null)
    setNavigationState('idle')

    try {
      const data = await getRoute(selectedOrigin.node_id, selectedDestination.node_id)
      if (!data?.path?.length) {
        setRouteError('No route was returned for these rooms.')
        return
      }

      setRouteData(data)
      setNavigationState('route_planned')
      // On phones the panel covers most of the map; fold it away so the
      // route is visible. The chevron brings it back.
      if (window.matchMedia('(max-width: 900px)').matches) setPanelCollapsed(true)
      const initialFloor =
        getFloorValue(data?.path?.[0]?.floor) ?? getFloorValue(selectedOrigin.floor) ?? 0
      setActiveFloor(initialFloor)
    } catch (error) {
      setRouteError(error?.response?.data?.message || 'Unable to load directions right now.')
    } finally {
      setRouteLoading(false)
    }
  }

  const handleStartJourney = () => {
    const startNode = routeData?.path?.[0]
    if (!startNode) return

    setLockedPolyline(
      routeData.polyline?.length
        ? routeData.polyline
        : routeData.path.map((node) => ({ lat: node.y, lng: node.x, floor: node.floor })),
    )
    setActiveFloor(
      getFloorValue(startNode.floor) ?? getFloorValue(selectedOrigin?.floor) ?? 0,
    )
    setJourneyNotice('')
    setAnsweredCheckpoints(new Set())
    setPromptOverride(null)
    setNavigationState('navigating')
    setStartToast(true)
    later(() => setStartToast(false), 5000)
  }

  const handleEndJourney = () => {
    setJourneyNotice('')
    setStartToast(false)
    setPromptOverride(null)
    setAnsweredCheckpoints(new Set())
    setLockedPolyline(null)
    setPendingOrigin(null)
    setLocationNote('')
    setNavigationState('idle')
    setRouteData(null)
    setSelectedOrigin(null)
    setSelectedDestination(null)
    setOriginQuery('')
    setDestinationQuery('')
    setOriginResults([])
    setDestinationResults([])
    setActiveFloor(0)
    setRouteError('')
  }

  const routeDistance = useMemo(() => {
    if (isNavigating && tracker.snapshot) return `${tracker.snapshot.remainingM.toFixed(0)} m`
    return Number.isFinite(routeData?.total_distance_m) ? `${routeData.total_distance_m.toFixed(1)} m` : '—'
  }, [isNavigating, routeData, tracker.snapshot])

  return (
    <div
      className={`app-shell ${navigationState === 'navigating' ? 'is-navigating' : ''} ${
        navigationState === 'idle' && !panelCollapsed ? 'search-open' : ''
      }`}
    >
      {navigationState !== 'navigating' ? (
      <header className="topbar">
        <div className="brand-block">
          <img className="brand-icon" src="/brand/logo.svg" alt="" width="44" height="44" />
          <div>
            <p className="eyebrow">College of Science · KNUST</p>
            <h1>COS Indoor Navigation</h1>
          </div>
        </div>
      </header>
      ) : null}

      <main className="app-layout">
        {navigationState === 'route_planned' ? (
          <JourneyIntro
            origin={selectedOrigin}
            destination={selectedDestination}
            route={routeData}
            onStart={handleStartJourney}
            onChange={resetPlannedRoute}
          />
        ) : null}

        {isNavigating ? (
          <DirectionBar
            snapshot={tracker.snapshot}
            step={upcomingStep}
            destinationName={selectedDestination ? getRoomName(selectedDestination) : 'your destination'}
            connection={journeyStatus}
            onExit={handleEndJourney}
            onReachedFloor={handleReachedFloor}
            onReachedEnd={tracker.reachLegEnd}
          />
        ) : null}
        {isNavigating && (journeyNotice || locationError) ? (
          <p className="journey-notice">{journeyNotice || locationError}</p>
        ) : null}

        {navigationState === 'idle' ? (
        <section className={`panel search-panel ${panelCollapsed ? 'collapsed' : ''}`}>
          <button
            type="button"
            className="panel-header"
            onClick={() => setPanelCollapsed((collapsed) => !collapsed)}
            aria-expanded={!panelCollapsed}
          >
            <span className="label-wrap">
              <Search size={18} />
              <span className="panel-title">
                {panelCollapsed && (selectedOrigin || selectedDestination)
                  ? [selectedOrigin, selectedDestination].filter(Boolean).map(getRoomName).join(' → ')
                  : 'Find your route'}
              </span>
            </span>
            <span className="panel-toggle" aria-hidden="true">
              {panelCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </span>
          </button>

          <div className="panel-body">
            <SearchBar
              label="Current Location"
              placeholder="Search current location"
              value={originQuery}
              disabled={routeLoading || navigationState === 'navigating'}
              onChange={(value) => {
                setOriginQuery(value)
                setSelectedOrigin(null)
                setNearbyOrigins([])
                setLocationNote('')
                resetPlannedRoute()
                setPendingOrigin(null)
                handleRoomSearch(value, 'origin')
              }}
              results={originResults}
              selectedRoom={selectedOrigin}
              onSelect={(room) => {
                setSelectedOrigin(room)
                setOriginQuery(getRoomName(room))
                setOriginResults([])
                setNearbyOrigins((rooms) => rooms.filter((candidate) => candidate.node_id !== room.node_id))
                resetPlannedRoute()
              }}
              action={
                <button
                  type="button"
                  className="my-location-button"
                  onClick={() => {
                    setPendingOrigin(null)
                    setNearbyOrigins([])
                    setLocationNote('')
                    setAskingFloor((asking) => !asking)
                  }}
                  disabled={locating || routeLoading || isNavigating}
                  aria-expanded={askingFloor}
                >
                  <Crosshair size={14} />
                  {locating ? 'Locating…' : 'My location'}
                </button>
              }
              note={locationNote}
              onClear={() => {
                setSelectedOrigin(null)
                setNearbyOrigins([])
                setPendingOrigin(null)
                setLocationNote('')
                setOriginQuery('')
                setOriginResults([])
                resetPlannedRoute()
              }}
            />

            {askingFloor ? (
              <div className="confirm-location" role="dialog" aria-label="Which floor are you on?">
                <p className="confirm-question">Which floor are you on?</p>
                <p className="field-note">GPS can't tell floors apart, so this keeps the suggestions on your floor.</p>
                <div className="floor-choices">
                  {Object.entries(FLOORS)
                    .sort(([a], [b]) => Number(b) - Number(a))
                    .map(([value, floor]) => (
                      <button
                        key={value}
                        type="button"
                        className={Number(value) === Number(activeFloor) ? 'current' : ''}
                        onClick={() => handleUseMyLocation(Number(value))}
                      >
                        <strong>{floor.code}</strong>
                        <small>{floor.label.replace(/\s*\(.*\)$/, '')}</small>
                      </button>
                    ))}
                </div>
                <div className="confirm-actions">
                  <button type="button" className="confirm-no" onClick={() => setAskingFloor(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {pendingOrigin ? (
              <div className="confirm-location" role="dialog" aria-label="Confirm your current location">
                <p className="confirm-question">Is this your current location?</p>
                <p className="confirm-room">
                  <strong>{getRoomName(pendingOrigin.room)}</strong>
                  <span className="floor-badge">{getFloorLabel(pendingOrigin.room.floor)}</span>
                </p>
                <p className="field-note">
                  Nearest room on {getFloorLabel(pendingOrigin.floor)} to your GPS (±{pendingOrigin.accuracy} m)
                  {pendingOrigin.accuracy > 40
                    ? '. That fix is very rough; if none of these is right, search for your room.'
                    : pendingOrigin.accuracy > 15
                      ? '. Indoor GPS is rough, so check it.'
                      : '.'}
                </p>
                <div className="confirm-actions">
                  <button type="button" className="confirm-yes" onClick={() => confirmPendingOrigin()}>
                    Yes, I'm here
                  </button>
                  <button
                    type="button"
                    className="confirm-no"
                    onClick={() => {
                      setPendingOrigin(null)
                      setNearbyOrigins([])
                      setLocationNote('Search for the room you are at instead.')
                    }}
                  >
                    No
                  </button>
                </div>
                {nearbyOrigins.length > 0 ? (
                  <div className="nearby-alternatives">
                    <span>Or I'm at:</span>
                    {nearbyOrigins.map((room) => (
                      <button key={room.node_id} type="button" onClick={() => confirmPendingOrigin(room)}>
                        {getRoomName(room)}
                        {Number.isFinite(room.distance_m) ? <small>{Math.round(room.distance_m)} m</small> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <SearchBar
              label="Destination"
              placeholder="Search destination room"
              value={destinationQuery}
              disabled={routeLoading || navigationState === 'navigating'}
              onChange={(value) => {
                setDestinationQuery(value)
                setSelectedDestination(null)
                resetPlannedRoute()
                handleRoomSearch(value, 'destination')
              }}
              results={destinationResults}
              selectedRoom={selectedDestination}
              onSelect={(room) => {
                setSelectedDestination(room)
                setDestinationQuery(getRoomName(room))
                setDestinationResults([])
              }}
              onClear={() => {
                setSelectedDestination(null)
                setDestinationQuery('')
                setDestinationResults([])
                resetPlannedRoute()
              }}
            />

            <button className="directions-button" type="button" onClick={handleGetDirections} disabled={routeLoading || !selectedOrigin || !selectedDestination}>
              {routeLoading ? 'Planning route…' : 'Get Directions'}
            </button>

            {routeError ? <p className="route-error">{routeError}</p> : null}
          </div>
        </section>
        ) : null}

        <section className={`map-panel ${isNavigating ? 'is-navigating' : ''}`}>
          <div className="map-toolbar">
            <div className="active-floor-badge">{getFloorLabel(activeFloor)}</div>
          </div>

          {startToast ? (
            <div className="start-toast" role="status">
              <img src="/brand/logo.svg" alt="" width="40" height="40" />
              <p>
                <strong>We have your current location.</strong>
                Kindly stay on course to the end of your journey.
              </p>
            </div>
          ) : null}

          <IndoorMap
            routeData={displayRoute}
            activeFloor={activeFloor}
            navigationState={navigationState}
            mapMode={mapMode}
            floorPlanConfig={defaultFloorPlanConfig}
            selectedDestination={selectedDestination}
            livePosition={trackedPosition}
          />
          {/* Before the journey: the steps. During it: landmark questions. */}
          {navigationState === 'route_planned' ? (
            <RouteSummaryDrawer
              routeData={routeData}
              distanceLabel={routeDistance}
              navigationState={navigationState}
              onSelectFloor={setActiveFloor}
            />
          ) : null}
          {isNavigating ? (
            <LandmarkPrompt
              prompt={prompt}
              onYes={handleLandmarkYes}
              onNo={handleLandmarkNo}
              onPick={handleLandmarkPick}
              onNoneOfThese={() => setPromptOverride({ stage: 'lost' })}
              onKeepGoing={() => setPromptOverride(null)}
              onEndJourney={handleEndJourney}
            />
          ) : null}

          {!isNavigating ? (
          <FloorControls
            activeFloor={activeFloor}
            onFloorChange={setActiveFloor}
            floors={FLOORS}
          />
          ) : null}
        </section>
      </main>
    </div>
  )
}

export default App
