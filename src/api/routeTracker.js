import { useEffect, useMemo, useRef, useState } from 'react'

// Route-locked position tracking.
//
// Indoor GPS wanders 5-20 m and twitches even when the user stands still, so
// the raw fix is never shown. Instead the journey's route is split into legs,
// one per stretch on a single floor, and each fix is:
//   1. dropped if its reported accuracy is hopeless,
//   2. smoothed with the previous fixes,
//   3. projected onto the current leg near where the user already is,
//   4. allowed to move the marker forward only, at walking speed.
// At the end of a leg that leads to another floor the tracker waits at the
// stairs until the user confirms they have reached the next floor (GPS cannot
// tell floors apart), then carries on along the next leg.

const MAX_ACCURACY_M = 50 // ignore fixes worse than this
const SMOOTHING = 0.35 // weight of the newest fix in the running average
const LOOK_BEHIND_M = 4 // projection window behind the marker...
const LOOK_AHEAD_M = 25 // ...and ahead of it, so a parallel corridor further along is never picked
const WALKING_SPEED_MS = 2.0 // brisk walk; caps how far one fix can advance
const MIN_STEP_M = 3 // always allow this much per fix (first fixes, slow devices)
const LEG_END_M = 3 // this close to the end of a leg counts as reaching it
const PASS_THROUGH_LEG_M = 5 // shorter legs are just stair landings passed on the way
const CALIBRATION_FIXES = 5 // fixes averaged at a confirmed spot to measure the GPS offset
const DEADBAND_M = 2 // ignore forward moves smaller than this (residual jitter)

const EARTH_M_PER_DEG = 111320

const toLocal = (origin) => (lat, lng) => ({
  x: (lng - origin.lng) * EARTH_M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180),
  y: (lat - origin.lat) * EARTH_M_PER_DEG,
})

/** Splits a route polyline into same-floor legs with cumulative distances. */
export function buildLegs(polyline) {
  if (!polyline?.length) return []
  const project = toLocal(polyline[0])
  const legs = []
  for (const point of polyline) {
    const floor = Number(point.floor)
    let leg = legs[legs.length - 1]
    if (!leg || leg.floor !== floor) {
      leg = { floor, points: [], length: 0 }
      legs.push(leg)
    }
    const { x, y } = project(point.lat, point.lng)
    const previous = leg.points[leg.points.length - 1]
    const s = previous ? previous.s + Math.hypot(x - previous.x, y - previous.y) : 0
    leg.points.push({ lat: point.lat, lng: point.lng, x, y, s })
    leg.length = s
  }
  return { legs, project }
}

function pointAt(leg, s) {
  const points = leg.points
  if (s <= 0 || points.length === 1) return points[0]
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    if (s <= b.s) {
      const t = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s)
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        s,
        index,
      }
    }
  }
  return { ...points[points.length - 1], index: points.length - 1 }
}

/** Distance along the leg of the point nearest (x, y), searched within [from, to]. */
function projectOnto(leg, x, y, from, to) {
  let best = null
  const points = leg.points
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    if (b.s < from || a.s > to) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    let t = lengthSquared ? ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared : 0
    t = Math.max(0, Math.min(1, t))
    const s = Math.max(from, Math.min(to, a.s + (b.s - a.s) * t))
    const px = a.x + dx * t
    const py = a.y + dy * t
    const distance = Math.hypot(x - px, y - py)
    if (!best || distance < best.distance) best = { s, distance }
  }
  return best
}

export class RouteTracker {
  constructor(polyline) {
    const built = buildLegs(polyline)
    this.legs = built.legs ?? []
    this.project = built.project
    this.legIndex = 0
    this.progress = 0
    this.smoothed = null
    this.lastFixTime = null
    this.calibration = []
    this.offset = { x: 0, y: 0 }
    this.status = this.legs.length ? 'tracking' : 'idle'
    this.distanceFromRoute = null
    this.settleAtLegEnd()
  }

  get leg() {
    return this.legs[this.legIndex]
  }

  /** The leg the user is heading to after the stairs, skipping landings passed through. */
  nextLegIndex() {
    for (let index = this.legIndex + 1; index < this.legs.length; index += 1) {
      if (index === this.legs.length - 1 || this.legs[index].length >= PASS_THROUGH_LEG_M) return index
    }
    return -1
  }

  settleAtLegEnd() {
    const leg = this.leg
    if (!leg || leg.length - this.progress > LEG_END_M) return
    this.progress = leg.length
    this.status = this.nextLegIndex() === -1 ? 'arrived' : 'at_stairs'
  }

  /** Feeds one GPS fix ({lat, lng, accuracy}, timestamp in ms). */
  update(fix, timestamp = Date.now()) {
    if (this.status !== 'tracking' || !this.leg) return false
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return false
    if (Number.isFinite(fix.accuracy) && fix.accuracy > MAX_ACCURACY_M) return false

    const measured = this.project(fix.lat, fix.lng)

    // The user is standing at the confirmed spot: learn the GPS offset.
    if (this.calibration.length < CALIBRATION_FIXES) {
      this.calibration.push(measured)
      const anchor = pointAt(this.leg, this.progress)
      const n = this.calibration.length
      this.offset = {
        x: this.calibration.reduce((sum, p) => sum + p.x, 0) / n - anchor.x,
        y: this.calibration.reduce((sum, p) => sum + p.y, 0) / n - anchor.y,
      }
      this.lastFixTime = timestamp
      return n === 1 || n === CALIBRATION_FIXES // refresh when calibration starts and ends
    }

    const raw = { x: measured.x - this.offset.x, y: measured.y - this.offset.y }
    this.smoothed = this.smoothed
      ? {
          x: this.smoothed.x + (raw.x - this.smoothed.x) * SMOOTHING,
          y: this.smoothed.y + (raw.y - this.smoothed.y) * SMOOTHING,
        }
      : raw

    const leg = this.leg
    const hit = projectOnto(
      leg,
      this.smoothed.x,
      this.smoothed.y,
      Math.max(0, this.progress - LOOK_BEHIND_M),
      Math.min(leg.length, this.progress + LOOK_AHEAD_M),
    )
    if (!hit) return false
    this.distanceFromRoute = hit.distance

    const elapsed = this.lastFixTime ? Math.max(0, (timestamp - this.lastFixTime) / 1000) : 0
    this.lastFixTime = timestamp
    const maxStep = MIN_STEP_M + WALKING_SPEED_MS * elapsed
    // Forward only: a fix that lands behind the marker is jitter, not the
    // user walking backwards along their own route.
    if (hit.s - this.progress < DEADBAND_M) return false
    const next = Math.min(hit.s, this.progress + maxStep)
    this.progress = next
    this.settleAtLegEnd()
    return true
  }

  /** The user says they are already at the end of this leg (stairs or destination). */
  reachLegEnd() {
    if (this.status !== 'tracking' || !this.leg) return false
    this.progress = this.leg.length
    this.settleAtLegEnd()
    return true
  }

  /** The user says they have reached the next floor. */
  confirmFloorChange() {
    if (this.status !== 'at_stairs') return false
    this.legIndex = this.nextLegIndex()
    this.progress = 0
    this.smoothed = null
    this.lastFixTime = null
    this.calibration = [] // the user is at the stairs: re-measure the offset here
    this.status = 'tracking'
    this.settleAtLegEnd()
    return true
  }

  snapshot() {
    const leg = this.leg
    if (!leg) return null
    const here = pointAt(leg, this.progress)
    const nextIndex = this.nextLegIndex()
    let remaining = leg.length - this.progress
    for (let index = this.legIndex + 1; index < this.legs.length; index += 1) remaining += this.legs[index].length

    // What is left to walk: from the marker to the end of this leg, then
    // every later leg. The map draws this instead of the full route.
    const remainingPolyline = [{ lat: here.lat, lng: here.lng, floor: leg.floor }]
    for (const point of leg.points.slice(here.index ?? leg.points.length)) {
      if (point.s > this.progress) remainingPolyline.push({ lat: point.lat, lng: point.lng, floor: leg.floor })
    }
    for (const later of this.legs.slice(this.legIndex + 1)) {
      for (const point of later.points) remainingPolyline.push({ lat: point.lat, lng: point.lng, floor: later.floor })
    }

    return {
      status: this.status,
      calibrating: this.status === 'tracking' && this.calibration.length < CALIBRATION_FIXES,
      gpsOffsetM: Math.hypot(this.offset.x, this.offset.y),
      floor: leg.floor,
      position: { lat: here.lat, lng: here.lng, floor: leg.floor },
      nextFloor: nextIndex === -1 ? null : this.legs[nextIndex].floor,
      remainingM: Math.max(0, remaining),
      distanceFromRouteM: this.distanceFromRoute,
      remainingPolyline,
    }
  }
}

/**
 * Watches the device location while `enabled` and locks it to `polyline`.
 * Returns the tracker snapshot plus `confirmFloorChange` and any location error.
 */
export function useRouteTracker({ enabled, polyline }) {
  const trackerRef = useRef(null)
  const [state, setState] = useState({ polyline: null, snapshot: null, error: '' })

  // Before the first fix the marker sits at the start of the route.
  const initial = useMemo(
    () => (enabled && polyline?.length ? new RouteTracker(polyline).snapshot() : null),
    [enabled, polyline],
  )

  useEffect(() => {
    if (!enabled || !polyline?.length) return undefined
    const tracker = new RouteTracker(polyline)
    trackerRef.current = tracker
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return undefined

    const watchId = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        if (trackerRef.current !== tracker) return
        if (tracker.update({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }, timestamp)) {
          setState({ polyline, snapshot: tracker.snapshot(), error: '' })
        }
      },
      (failure) =>
        setState((previous) => ({
          ...previous,
          error: failure.code === 1 ? 'Location permission was denied.' : failure.message || 'Unable to read your location.',
        })),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    )
    return () => {
      navigator.geolocation.clearWatch(watchId)
      if (trackerRef.current === tracker) trackerRef.current = null
    }
  }, [enabled, polyline])

  const confirmFloorChange = () => {
    const tracker = trackerRef.current
    if (tracker?.confirmFloorChange()) setState({ polyline, snapshot: tracker.snapshot(), error: '' })
  }

  // GPS can fall short of the stairs or the destination; let the user say so.
  const reachLegEnd = () => {
    const tracker = trackerRef.current
    if (tracker?.reachLegEnd()) setState({ polyline, snapshot: tracker.snapshot(), error: '' })
  }

  // A snapshot from a previous route (or journey) is never shown for a new one.
  const current = state.polyline === polyline ? state.snapshot : null
  return {
    snapshot: enabled ? current ?? initial : null,
    error: enabled ? state.error : '',
    confirmFloorChange,
    reachLegEnd,
  }
}
