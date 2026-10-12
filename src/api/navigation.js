import apiClient from './client'

export const searchRooms = async (q = '') => {
  try {
    const response = await apiClient.get('/rooms/search', {
      params: { q },
    })

    return response.data?.results || []
  } catch (error) {
    console.error('Error fetching room search results:', error)
    return []
  }
}

export const getRoute = async (fromId, toId) => {
  try {
    const response = await apiClient.get('/navigate', {
      params: {
        from_node_id: fromId,
        to_node_id: toId,
      },
    })

    return response.data
  } catch (error) {
    console.error('Error fetching route:', error)
    throw error
  }
}

// Rooms closest to a device location on one floor, nearest first, each with
// distance_m. GPS cannot tell floors apart, so the caller supplies the floor.
// radiusM (optional) drops rooms further than that; the closest few are
// always returned.
export const getNearbyRooms = async (lat, lng, floor, limit = 5, radiusM) => {
  const response = await apiClient.get('/rooms/nearest', {
    params: { lat, lng, floor, limit, ...(radiusM ? { radius_m: Math.round(radiusM) } : {}) },
  })
  return response.data?.results || []
}
