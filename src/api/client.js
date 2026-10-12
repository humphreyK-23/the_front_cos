import axios from 'axios'

const apiClient = axios.create({
  // Same-origin: the Vite dev server forwards /api to the Go backend (see
  // vite.config.js), so this works on localhost and from a phone alike.
  baseURL: '/api',
  timeout: 10000,
})

export default apiClient
