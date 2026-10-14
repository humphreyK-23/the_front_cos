import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet-imageoverlay-rotated'
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  useMap,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  COS_BOUNDS,
  COS_CENTER,
  COS_FLOOR_CORNERS,
  COS_IMAGE_BOUNDS,
  FLOORS,
  getFloorValue,
} from '../../utils/floors'

// Let users pan a little past the plan edges before maxBounds pushes back.
const PAN_BOUNDS = L.latLngBounds(COS_IMAGE_BOUNDS).pad(0.25)

// 1. Icon definitions using string HTML
const currentLocationIcon = L.divIcon({
  className: 'custom-user-location-marker',
  html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;width:24px;height:24px;">
          <div style="position:absolute;width:24px;height:24px;background-color:rgba(245,197,24,0.55);border-radius:50%;animation:ping 1s cubic-bezier(0,0,0.2,1) infinite;"></div>
          <div style="width:14px;height:14px;background-color:#0b6e3b;border:3px solid #f5c518;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>
         </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

const destinationPinIcon = L.divIcon({
  className: 'custom-destination-marker',
  html: `<div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;color:#111111;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:32px;height:32px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">
            <circle cx="12" cy="10.5" r="3.4" fill="#f5c518" />
            <path fill-rule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
          </svg>
         </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
})

function MapViewport({ bounds, focusPosition, navigationState }) {
  const map = useMap()

  useEffect(() => {
    if (navigationState === 'navigating' && focusPosition) {
      map.flyTo(focusPosition, 21, { duration: 0.8 })
    } else if (bounds) {
      map.fitBounds(bounds, { padding: [15, 15] })
    }
  }, [bounds, focusPosition, map, navigationState])

  return null
}

// The plans are square to the building, which is rotated 11.8° from north, so a
// plain north-up ImageOverlay would skew them. Place the image by its corners.
function RotatedFloorOverlay({ url, corners, opacity = 1, zIndex = 10 }) {
  const map = useMap()

  useEffect(() => {
    const { topLeft, topRight, bottomLeft } = corners
    const overlay = L.imageOverlay
      .rotated(url, topLeft, topRight, bottomLeft, { opacity, zIndex })
      .addTo(map)
    return () => overlay.remove()
  }, [map, url, corners, opacity, zIndex])

  return null
}

// Split the route line into runs on the shown floor. The backend's polyline
// follows the drawn corridors, so bends and turns appear on the map; older
// responses without it fall back to joining the path nodes.
function routeSegmentsForFloor(routeData, floor) {
  const points = routeData?.polyline?.length
    ? routeData.polyline.map((point) => ({ floor: point.floor, latLng: [point.lat, point.lng] }))
    : (routeData?.path ?? []).map((node) => ({ floor: node.floor, latLng: [node.y, node.x] }))

  const segments = []
  let current = []
  for (const point of points) {
    if (Number(point.floor) === Number(floor)) {
      current.push(point.latLng)
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments
}

export default function IndoorMap({
  routeData,
  activeFloor = 0,
  navigationState = 'idle',
  selectedDestination,
  livePosition = null,
}) {
  const floorKey = String(getFloorValue(activeFloor))
  const activePlan = FLOORS[floorKey] || FLOORS['0']
  const planCorners = activePlan?.corners || COS_FLOOR_CORNERS

  const routeSegments = useMemo(
    () => routeSegmentsForFloor(routeData, activeFloor),
    [routeData, activeFloor],
  )
  const routeStart = routeSegments[0]?.[0] ?? null
  const lastSegment = routeSegments[routeSegments.length - 1]
  const routeEnd = lastSegment?.[lastSegment.length - 1] ?? null
  const destinationOnFloor =
    routeData?.path?.length &&
    Number(routeData.path[routeData.path.length - 1].floor) === Number(activeFloor)
  const userPosition =
    navigationState === 'navigating' && livePosition
      ? [livePosition.lat, livePosition.lng]
      : routeStart
  const focusPosition = userPosition

  return (
    <div className="w-full h-full bg-slate-100 relative overflow-hidden">
      <MapContainer 
        center={COS_CENTER}
        zoom={20}
        minZoom={18}
        maxZoom={22}
        maxBounds={PAN_BOUNDS}
        maxBoundsViscosity={1.0}
        scrollWheelZoom 
        zoomControl={false}
        className="h-full w-full bg-slate-100"
      >
        <MapViewport
          bounds={COS_BOUNDS}
          focusPosition={focusPosition}
          navigationState={navigationState}
        />

        {/* Dynamic Floor Plan Overlay */}
        {activePlan?.url && (
          <RotatedFloorOverlay
            key={floorKey}
            url={activePlan.url}
            corners={planCorners}
          />
        )}

        {/* Route Polyline (one line per stretch on this floor) */}
        {routeSegments
          .filter((segment) => segment.length > 1)
          .map((segment, index) => (
            <Polyline
              key={`${floorKey}-${index}`}
              positions={segment}
              pathOptions={{
                color: '#0b6e3b',
                weight: 5,
                opacity: 1.0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          ))}

        {userPosition && ( //user current location
          <Marker position={userPosition} icon={currentLocationIcon}>
            <Popup>{navigationState === 'navigating' && livePosition ? 'You are here' : 'Start Location'}</Popup>
          </Marker>
        )}

        {destinationOnFloor && routeEnd && ( // user destination point.
          <Marker position={routeEnd} icon={destinationPinIcon}>
            <Popup>{selectedDestination?.name || 'Destination'}</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}