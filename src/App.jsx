import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Crosshair, MapPinned, Navigation, Play, Search, Square } from 'lucide-react'
import './App.css'
import SearchBar from './components/Search/SearchBar'
import FloorControls from './components/Map/FloorControls'
import IndoorMap from './components/Map/IndoorMap'
import { searchRooms, getRoute, getNearbyRooms } from './api/navigation'
import { getBestLocationFix, useJourneySocket } from './api/journeySocket'
import { useRouteTracker } from './api/routeTracker'
import { FLOORS, getFloorLabel, getFloorValue, COS_BOUNDS, COS_FLOOR_CORNERS } from './utils/floors' 
import { getRoomName } from './utils/rooms'
import RouteSummaryDrawer from './components/Navigation/RouteSummaryDrawer'

// Build config dynamically from object entries instead of .map
const defaultFloorPlanConfig = Object.fromEntries(
  Object.entries(FLOORS).map(([key, floor]) => [
    key,
    { url: floor.url || floor.image, bounds: floor.bounds || COS_BOUNDS || COS_FLOOR_CORNERS, corners: floor.corners || COS_FLOOR_CORNERS },
  ])
)

// Status of the route-locked journey, shown over the map.
function JourneyBanner({ snapshot, onReachedFloor, onReachedEnd, destinationName }) {
  if (snapshot.status === 'arrived') {
    return <div className="journey-banner arrived">You have arrived at {destinationName}.</div>
  }
  if (snapshot.status === 'at_stairs') {
    const direction = snapshot.nextFloor > snapshot.floor ? 'up' : 'down'
    return (
      <div className="journey-banner">
        <span>
          Take the stairs {direction} to <strong>{getFloorLabel(snapshot.nextFloor)}</strong>.
        </span>
        <button type="button" onClick={onReachedFloor}>
          I'm on {getFloorLabel(snapshot.nextFloor)} now
        </button>
      </div>
    )
  }
  return (
    <div className="journey-banner">
      <span>
        {snapshot.calibrating
          ? 'Locking onto your position… stand still for a moment.'
          : `${Math.round(snapshot.remainingM)} m to go${snapshot.nextFloor !== null ? ` · stairs to ${getFloorLabel(snapshot.nextFloor)} ahead` : ''}`}
      </span>
      <button type="button" className="secondary" onClick={onReachedEnd}>
        {snapshot.nextFloor !== null ? "I'm at the stairs" : "I've arrived"}
      </button>
    </div>
  )
}

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
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationNote, setLocationNote] = useState('')
  const [nearbyOrigins, setNearbyOrigins] = useState([])
  // Nearest room found from GPS, waiting for "Is this your current location?"
  const [pendingOrigin, setPendingOrigin] = useState(null)
  // "My location" first asks which floor the user is on: GPS cannot tell.
  const [askingFloor, setAskingFloor] = useState(false)
  // The route as planned when the journey started; the tracker follows it.
  const [lockedPolyline, setLockedPolyline] = useState(null)

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
    setNavigationState('navigating')
  }

  const handleEndJourney = () => {
    setJourneyNotice('')
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-icon">
            <Navigation size={18} />
          </div>
          <div>
            <p className="eyebrow">College wayfinding</p>
            <h1>COS Indoor Naviagtion </h1>
          </div>
        </div>
      </header>

      <main className="app-layout">
        <section className={`panel search-panel ${panelCollapsed ? 'collapsed' : ''}`}>
          <div className="panel-header">
            <div className="label-wrap">
              <Search size={18} />
              <h2>Find your route</h2>
            </div>
            <button
              type="button"
              className="panel-toggle"
              onClick={() => setPanelCollapsed((collapsed) => !collapsed)}
              aria-label={panelCollapsed ? 'Expand search panel' : 'Collapse search panel'}
            >
              {panelCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </button>
          </div>

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

            <div className="route-meta">
              <div className="meta-pill">
                <MapPinned size={16} />
                <span>{selectedOrigin ? `From ${getRoomName(selectedOrigin)}` : 'Choose start'}</span>
              </div>
              <div className="meta-pill">
                <span>{selectedDestination ? `To ${getRoomName(selectedDestination)}` : 'Choose destination'}</span>
              </div>
            </div>

            {navigationState === 'navigating' ? (
              <button className="journey-button end-journey" type="button" onClick={handleEndJourney}>
                <Square size={16} /> End Journey
              </button>
            ) : navigationState === 'route_planned' ? (
              <button className="journey-button start-journey" type="button" onClick={handleStartJourney}>
                <Play size={16} /> Start Journey
              </button>
            ) : (
              <button className="directions-button" type="button" onClick={handleGetDirections} disabled={routeLoading || !selectedOrigin || !selectedDestination}>
                {routeLoading ? 'Planning route…' : 'Get Directions'}
              </button>
            )}

            {routeError ? <p className="route-error">{routeError}</p> : null}
            {isNavigating && (journeyNotice || locationError) ? (
              <p className="route-error">{journeyNotice || locationError}</p>
            ) : null}
          </div>
        </section>

        <section className="map-panel">
          <div className="map-toolbar">
            <div className="active-floor-badge">{getFloorLabel(activeFloor)}</div>
            {isNavigating ? (
              <div className="active-floor-badge">
                {journeyStatus === 'live' ? 'Live' : journeyStatus === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
              </div>
            ) : null}
          </div>
          


          {isNavigating && tracker.snapshot ? (
            <JourneyBanner
              snapshot={tracker.snapshot}
              onReachedFloor={handleReachedFloor}
              onReachedEnd={tracker.reachLegEnd}
              destinationName={selectedDestination ? getRoomName(selectedDestination) : 'your destination'}
            />
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
          {/* Route summary: appears once directions have been fetched */}
          <RouteSummaryDrawer
            routeData={routeData}
            distanceLabel={routeDistance}
            navigationState={navigationState}
            onStartJourney={handleStartJourney}
            onSelectFloor={setActiveFloor}
          />

          <FloorControls
            activeFloor={activeFloor}
            onFloorChange={setActiveFloor}
            floors={FLOORS}
          />
        </section>
      </main>
    </div>
  )
}

export default App
