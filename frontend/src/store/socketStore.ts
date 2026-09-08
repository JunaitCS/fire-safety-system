import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'

interface SocketState {
  socket: Socket | null
  isConnected: boolean
  lastBuildingId: string | null
  connect: () => void
  disconnect: () => void
  joinBuilding: (buildingId: string) => void
  joinEmergency: (emergencyId: string) => void
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  lastBuildingId: null,
  
  connect: () => {
    const existing = get().socket
    if (existing) {
      if (!existing.connected) existing.connect()
      return
    }
    // LAN-aware: fall back to the page's own hostname (not hardcoded localhost)
    // so phones/tablets on the same Wi-Fi reach the backend too. On a desktop
    // browser this resolves to localhost exactly as before.
    const host = (typeof window !== 'undefined' && window.location.hostname) || 'localhost'
    const url = (import.meta.env.VITE_SOCKET_URL as string) || `http://${host}:3001`
    const socket = io(url, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 15000,
    })
    
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id)
      set({ isConnected: true })
      // Rejoin the last building room so alerts resume after a drop.
      const last = get().lastBuildingId
      if (last) socket.emit('join-building', last)
    })
    
    socket.on('disconnect', () => {
      console.log('Socket disconnected')
      set({ isConnected: false })
    })
    
    set({ socket })
  },
  
  disconnect: () => {
    const { socket } = get()
    if (socket) {
      socket.disconnect()
      set({ socket: null, isConnected: false })
    }
  },
  
  joinBuilding: (buildingId: string) => {
    const { socket } = get()
    set({ lastBuildingId: buildingId })
    if (socket) {
      socket.emit('join-building', buildingId)
    }
  },
  
  joinEmergency: (emergencyId: string) => {
    const { socket } = get()
    if (socket) {
      socket.emit('join-emergency', emergencyId)
    }
  },
}))
