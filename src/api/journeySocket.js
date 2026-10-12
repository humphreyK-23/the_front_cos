import { useEffect, useRef, useState } from 'react'
import apiClient from './client'

// Live journey connection to the backend (/api/ws/journey).
//
// The socket reconnects on its own with exponential backoff and resumes the
// same server-side session, so a dropped Wi-Fi link, a locked screen or a
// backgrounded tab does not end the journey. Only the latest position is kept
// while offline; it is sent as soon as the connection is back.

const journeySocketUrl = () => {
  const base = new URL(apiClient.defaults.baseURL, window.location.href)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = `${base.pathname.replace(/\/$/, '')}/ws/journey`
  return base.toString()
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000
// The server pings every 20 s; if nothing arrives for this long the
// connection is presumed dead even if the browser has not noticed yet.
const STALE_CONNECTION_MS = 50000

export function useJourneySocket({ enabled, destinationNodeId, activePathNodeIds, position, onMessage }) {
  const [status, setStatus] = useState('idle') // idle | connecting | live | reconnecting
  const socketRef = useRef(null)
  const sessionIdRef = useRef(null)
  const pendingPositionRef = useRef(null)
  const onMessageRef = useRef(onMessage)
  const startRef = useRef({ destinationNodeId, activePathNodeIds })

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    startRef.current = { destinationNodeId, activePathNodeIds }
  }, [destinationNodeId, activePathNodeIds])

  useEffect(() => {
    if (!enabled || !destinationNodeId) return undefined

    let closedByUs = false
    let attempt = 0
    let reconnectTimer = null
    let staleTimer = null

    const sendJson = (payload) => {
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload))
        return true
      }
      return false
    }

    const flushPosition = () => {
      if (sessionIdRef.current && pendingPositionRef.current) {
        if (sendJson({ type: 'position', ...pendingPositionRef.current })) {
          pendingPositionRef.current = null
        }
      }
    }

    const armStaleTimer = (socket) => {
      clearTimeout(staleTimer)
      staleTimer = setTimeout(() => socket.close(4000, 'stale'), STALE_CONNECTION_MS)
    }

    const startSession = () => {
      sessionIdRef.current = null
      sendJson({
        type: 'start',
        destination_node_id: startRef.current.destinationNodeId,
        active_path_node_ids: startRef.current.activePathNodeIds ?? [],
      })
    }

    const connect = () => {
      clearTimeout(reconnectTimer)
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      const socket = new WebSocket(journeySocketUrl())
      socketRef.current = socket

      socket.onopen = () => {
        attempt = 0
        armStaleTimer(socket)
        if (sessionIdRef.current) {
          sendJson({ type: 'resume', session_id: sessionIdRef.current })
        } else {
          startSession()
        }
      }

      socket.onmessage = (event) => {
        armStaleTimer(socket)
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'session') {
          sessionIdRef.current = message.session_id
          setStatus('live')
          flushPosition()
          return
        }
        if (message.type === 'session_expired') {
          startSession()
          return
        }
        onMessageRef.current?.(message)
      }

      socket.onclose = () => {
        clearTimeout(staleTimer)
        if (socketRef.current === socket) socketRef.current = null
        if (closedByUs) return
        setStatus('reconnecting')
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
        attempt += 1
        reconnectTimer = setTimeout(connect, delay * (0.75 + Math.random() * 0.5))
      }

      socket.onerror = () => socket.close()
    }

    // Reconnect straight away when the device comes back online or the tab
    // becomes visible again, instead of waiting out the backoff.
    const reconnectNow = () => {
      if (closedByUs) return
      const socket = socketRef.current
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        attempt = 0
        connect()
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconnectNow()
    }
    window.addEventListener('online', reconnectNow)
    document.addEventListener('visibilitychange', onVisibility)

    connect()

    return () => {
      closedByUs = true
      clearTimeout(reconnectTimer)
      clearTimeout(staleTimer)
      window.removeEventListener('online', reconnectNow)
      document.removeEventListener('visibilitychange', onVisibility)
      const socket = socketRef.current
      if (socket) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'end' }))
        socket.close(1000, 'journey ended')
      }
      socketRef.current = null
      sessionIdRef.current = null
      pendingPositionRef.current = null
      setStatus('idle')
    }
  }, [enabled, destinationNodeId])

  // Queue the latest position and send it if the session is up.
  useEffect(() => {
    if (!enabled || !position) return
    pendingPositionRef.current = { lat: position.lat, lng: position.lng, floor: position.floor }
    const socket = socketRef.current
    if (sessionIdRef.current && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'position', ...pendingPositionRef.current }))
      pendingPositionRef.current = null
    }
  }, [enabled, position])

  return status
}

// One-off location fix for the "My location" button. Phones often return a
// coarse network fix first and sharpen it over a few seconds, so this keeps
// the most accurate reading until it is good enough or time runs out.
export function getBestLocationFix({ goodEnoughMeters = 10, maxWaitMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Location is not available on this device.'))
      return
    }
    if (!window.isSecureContext) {
      reject(new Error('Location needs the app to be opened over HTTPS (or on localhost).'))
      return
    }
    let best = null
    let watchId = null
    const finish = () => {
      clearTimeout(timer)
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      if (best) resolve(best)
      else reject(new Error('Could not get a location fix. Try again near a window.'))
    }
    const timer = setTimeout(finish, maxWaitMs)
    watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!best || coords.accuracy < best.accuracy) {
          best = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }
        }
        if (coords.accuracy <= goodEnoughMeters) finish()
      },
      (failure) => {
        clearTimeout(timer)
        if (watchId !== null) navigator.geolocation.clearWatch(watchId)
        if (best) resolve(best)
        else reject(new Error(failure.code === 1 ? 'Location permission was denied.' : failure.message || 'Unable to read your location.'))
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    )
  })
}
