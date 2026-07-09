import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json'
  }
})

// Request interceptor — attach token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor — handle errors + token refresh
let isRefreshing = false
let failedQueue: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Skip refresh only for the refresh endpoint itself (avoid infinite loop)
    if (error.config?.url?.includes('/auth/refresh')) {
      return Promise.reject(error)
    }

    const refreshCodes = ['TOKEN_EXPIRED', 'INVALID_TOKEN', 'TOKEN_REVOKED']
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (refreshCodes.includes(error.response.data?.code)) {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject })
          }).then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`
            return api(originalRequest)
          }).catch((err) => {
            return Promise.reject(err)
          })
        }

        originalRequest._retry = true
        isRefreshing = true

        try {
          const refreshToken = localStorage.getItem('refresh_token')
          if (!refreshToken) {
            throw new Error('No refresh token')
          }

          const baseURL = import.meta.env.VITE_API_URL || '/api'
          const response = await axios.post(`${baseURL}/auth/refresh`, {
            refresh_token: refreshToken
          })

          const { access_token, refresh_token: new_refresh } = response.data.data
          localStorage.setItem('access_token', access_token)
          localStorage.setItem('refresh_token', new_refresh)

          failedQueue.forEach(({ resolve }) => resolve(access_token))
          failedQueue = []

          originalRequest.headers.Authorization = `Bearer ${access_token}`
          return api(originalRequest)
        } catch (refreshError) {
          failedQueue.forEach(({ reject }) => reject(refreshError))
          failedQueue = []

          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          window.location.href = '/login'
          return Promise.reject(refreshError)
        } finally {
          isRefreshing = false
        }
      }
    }

    return Promise.reject(error)
  }
)

export default api