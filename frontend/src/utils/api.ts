import axios from 'axios'

const baseURL = (import.meta.env.VITE_API_URL as string) || '/api'

const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const stored = localStorage.getItem('fire-safety-auth')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      if (parsed.state?.token) {
        config.headers.Authorization = `Bearer ${parsed.state.token}`
      }
    } catch (e) {
      // ignore
    }
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || ''
      // Don't force logout on public / optional-auth endpoints
      const publicPrefixes = ['/buildings/qr/', '/presence/check-in', '/presence/check-out', '/presence/building/', '/presence/mine', '/presence/status']
      const isPublic = publicPrefixes.some((p) => url.includes(p))
      if (!isPublic && !window.location.pathname.startsWith('/building/')) {
        localStorage.removeItem('fire-safety-auth')
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)

export const getApiBase = () => baseURL.replace(/\/api$/, '')
// LAN-aware like the socket URL: same-Wi-Fi phones use the page hostname,
// desktop browsers keep resolving to localhost as before.
export const getCvBase = () => {
  const env = (import.meta.env.VITE_CV_URL as string) || ''
  if (env) return env
  const host = (typeof window !== 'undefined' && window.location.hostname) || 'localhost'
  return `http://${host}:5000`
}

export default api
