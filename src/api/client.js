import axios from 'axios'

const apiClient = axios.create({
  // Development: same-origin /api, which the Vite dev server forwards to the
  // Go backend (see vite.config.js), on localhost and from a phone alike.
  // Hosted: set VITE_API_URL to the backend, e.g. https://cos-api.onrender.com/api
  // (and add the frontend's address to the backend's ALLOWED_ORIGINS).
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 10000,
})

export default apiClient
