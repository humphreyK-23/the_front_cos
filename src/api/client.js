import axios from 'axios'

// Sent on every API request when set (the backend checks it when its API_KEY
// is set). It ships inside the app's JavaScript, so it keeps out casual
// scrapers and other sites, not a determined person reading the code.
export const API_KEY = import.meta.env.VITE_API_KEY || ''

const apiClient = axios.create({
  // Development: same-origin /api, which the Vite dev server forwards to the
  // Go backend (see vite.config.js), on localhost and from a phone alike.
  // Hosted: set VITE_API_URL to the backend, e.g. https://cos-api.onrender.com/api
  // (and add the frontend's address to the backend's ALLOWED_ORIGINS).
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 10000,
  headers: API_KEY ? { 'X-API-Key': API_KEY } : {},
})

export default apiClient
