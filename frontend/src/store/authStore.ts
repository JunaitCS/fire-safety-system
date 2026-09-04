import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: string
  email: string
  name: string
  role: 'MANAGER' | 'OCCUPANT' | 'RESPONDER'
  phone?: string
}

interface AuthState {
  user: User | null
  token: string | null
  setAuth: (user: User, token: string) => void
  logout: () => void
  getDashboardRoute: () => string
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      
      setAuth: (user, token) => set({ user, token }),

      logout: () => {
        set({ user: null, token: null })
        try {
          localStorage.removeItem('fireguard-presence')
        } catch {}
      },
      
      getDashboardRoute: () => {
        const { user } = get()
        if (!user) return '/login'
        
        switch (user.role) {
          case 'MANAGER':
            return '/manager'
          case 'RESPONDER':
            return '/responder'
          case 'OCCUPANT':
          default:
            return '/occupant'
        }
      },
    }),
    {
      name: 'fire-safety-auth',
    }
  )
)
