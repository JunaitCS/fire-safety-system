import { useEffect, useState } from 'react'
import { useSocketStore } from '../../store/socketStore'
import { useAuthStore } from '../../store/authStore'
import api from '../../utils/api'
import {
  BellAlertIcon,
  MapPinIcon,
  PhoneIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'

interface Emergency {
  id?: string
  emergencyId?: string
  buildingId: string
  severity: string
  type?: string
  title?: string
  message?: string
  startTime: string
  building?: { name: string; address: string }
  buildingName?: string
}

const normId = (e: Emergency | null) => e?.id || e?.emergencyId || ''
const isDrill = (e: Emergency | null) => (e?.type || '').toUpperCase() === 'DRILL' || /drill/i.test(e?.title || e?.message || '')

export default function EmergencyView() {
  const [activeEmergency, setActiveEmergency] = useState<Emergency | null>(null)
  const [loading, setLoading] = useState(true)
  const [sosSent, setSosSent] = useState(false)
  const [sosLocation, setSosLocation] = useState('')
  const [sosMessage, setSosMessage] = useState('')
  const [showSosModal, setShowSosModal] = useState(false)
  const [sosError, setSosError] = useState('')
  const { socket, connect, joinBuilding } = useSocketStore()
  const { user } = useAuthStore()

  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    checkActiveEmergency()
    // Poll fallback: even if the live socket drops, alerts start/end here
    // within seconds — never requires a page refresh.
    const t = window.setInterval(checkActiveEmergency, 5000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Join rooms for every checked-in building so room-scoped pushes arrive
  // instantly (in addition to the global broadcasts + polling above).
  useEffect(() => {
    if (!socket) return
    let cancelled = false
    api.get('/presence/mine').then((r) => {
      if (cancelled) return
      for (const p of r.data || []) {
        if (p.buildingId) joinBuilding(p.buildingId)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [socket, joinBuilding])

  useEffect(() => {
    if (!socket) return

    const relevant = async (data: Emergency) => {
      // Only show alerts for buildings the occupant is actively checked into.
      try {
        const mine = await api.get('/presence/mine')
        const ids: string[] = (mine.data || []).map((p: any) => p.buildingId)
        if (data?.buildingId && ids.length && !ids.includes(data.buildingId)) return
      } catch {}
      setActiveEmergency(data)
    }
    const onResolved = (data: { emergencyId: string }) => {
      setActiveEmergency((prev) => {
        if (!prev) return prev
        return normId(prev) === data.emergencyId ? null : prev
      })
      setSosSent(false)
    }
    // Drills started from the drill console end with drill-ended (not
    // emergency-resolved) — clear a drill banner, never a real fire one.
    const onDrillEnd = (data: { drillId?: string; buildingId?: string }) => {
      setActiveEmergency((prev) => {
        if (!prev || !isDrill(prev)) return prev
        if (data?.buildingId && prev.buildingId && data.buildingId !== prev.buildingId) return prev
        return null
      })
    }
    socket.on('fire-started', relevant)
    socket.on('drill-alert', relevant)
    socket.on('emergency-started', relevant)
    socket.on('building-emergency', relevant)
    socket.on('fire-started-global', relevant)
    socket.on('drill-alert-global', relevant)
    socket.on('emergency-resolved', onResolved)
    socket.on('fire-resolved', onResolved)
    socket.on('fire-resolved-global', onResolved)
    socket.on('drill-ended', onDrillEnd)
    socket.on('drill-ended-global', onDrillEnd)

    return () => {
      socket.off('fire-started', relevant)
      socket.off('drill-alert', relevant)
      socket.off('emergency-started', relevant)
      socket.off('building-emergency', relevant)
      socket.off('fire-started-global', relevant)
      socket.off('drill-alert-global', relevant)
      socket.off('emergency-resolved', onResolved)
      socket.off('fire-resolved', onResolved)
      socket.off('fire-resolved-global', onResolved)
      socket.off('drill-ended', onDrillEnd)
      socket.off('drill-ended-global', onDrillEnd)
    }
  }, [socket])

  const checkActiveEmergency = async () => {
    try {
      const mine = await api.get('/presence/mine').catch(() => ({ data: [] }))
      const ids: string[] = (mine.data || []).map((p: any) => p.buildingId)
      const response = await api.get('/emergency/active')
      const list: Emergency[] = response.data || []
      // STRICT: never show a building the occupant is not checked into.
      const mine2 = ids.length ? list.filter((e) => ids.includes(e.buildingId)) : []
      if (mine2.length > 0) {
        // Prefer real FIRE over DRILL
        const fire = mine2.find((e) => (e.type || 'FIRE') === 'FIRE') || mine2[0]
        setActiveEmergency(fire)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const sendSOS = async () => {
    if (!activeEmergency || !user) return
    setSosError('')
    if (!sosLocation.trim()) {
      setSosError('Please enter your location so responders can find you.')
      return
    }
    try {
      await api.post('/sos', {
        buildingId: activeEmergency.buildingId,
        emergencyId: normId(activeEmergency),
        location: sosLocation,
        message: sosMessage,
      })
      setSosSent(true)
      setShowSosModal(false)
    } catch (error) {
      setSosError('Failed to send SOS. Please call emergency services directly.')
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-12 flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-red-200 border-t-red-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Checking for active emergencies…</p>
      </div>
    )
  }

  if (!activeEmergency) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircleIcon className="w-10 h-10 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">All Clear</h1>
        <p className="text-gray-600">No active emergencies for buildings you're checked into.</p>
      </div>
    )
  }

  const drill = isDrill(activeEmergency)

  return (
    <div className="max-w-2xl mx-auto">
      <div className={`${drill ? 'bg-amber-500' : 'bg-red-600 animate-pulse'} text-white rounded-xl p-6 mb-6`}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
            <BellAlertIcon className="w-8 h-8 animate-bounce" />
          </div>
          <div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${drill ? 'bg-white/25' : 'bg-black/25'}`}>
              {drill ? 'FIRE DRILL — PRACTICE ONLY' : 'REAL FIRE EMERGENCY'}
            </span>
            <h1 className="text-2xl font-bold mt-1">{drill ? 'DRILL IN PROGRESS' : 'FIRE EMERGENCY'}</h1>
            <p className={`${drill ? 'text-amber-50' : 'text-red-100'}`}>
              {drill ? 'Practice evacuation — proceed calmly to exits' : 'Evacuate immediately via nearest exit'}
            </p>
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <MapPinIcon className="w-5 h-5 text-gray-500" /> Building Information
        </h2>
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="font-medium">{activeEmergency.building?.name || activeEmergency.buildingName || 'Building'}</p>
          <p className="text-gray-600 text-sm">{activeEmergency.building?.address}</p>
          <p className="text-gray-500 text-xs mt-2">
            Started: {activeEmergency.startTime ? new Date(activeEmergency.startTime).toLocaleTimeString() : ''} · Severity: {activeEmergency.severity}
          </p>
        </div>
      </div>

      <div className="card mb-6">
        <h2 className="font-semibold mb-3">Evacuation Instructions</h2>
        <div className="space-y-3">
          {['Stay calm and walk, do not run', 'Use stairs, never use elevators', 'Follow the nearest exit signs', 'Proceed to designated assembly point'].map((t, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg ${drill ? 'bg-amber-50' : 'bg-orange-50'}`}>
              <span className="font-bold text-orange-600">{i + 1}</span>
              <p className="text-gray-700">{t}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500" /> Need Help?
        </h2>
        {sosSent ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <CheckCircleIcon className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <p className="text-green-800 font-medium">SOS Sent Successfully</p>
            <p className="text-green-600 text-sm mt-1">Responders have been notified.</p>
          </div>
        ) : (
          <>
            <p className="text-gray-600 mb-4">
              If you are trapped or injured, send an SOS alert.
            </p>
            <button onClick={() => setShowSosModal(true)} className="w-full btn-danger py-4 text-lg flex items-center justify-center gap-2">
              <PhoneIcon className="w-6 h-6" /> SEND SOS ALERT
            </button>
          </>
        )}
      </div>

      {showSosModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <PhoneIcon className="w-6 h-6 text-red-600" /> Send SOS
            </h2>
            {sosError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{sosError}</div>
            )}
            <div className="space-y-4">
              <div>
                <label className="label">Your Location</label>
                <input className="input" value={sosLocation} onChange={(e) => setSosLocation(e.target.value)} placeholder="Room 205, near Stairwell B" />
              </div>
              <div>
                <label className="label">Message (optional)</label>
                <textarea className="input h-24 resize-none" value={sosMessage} onChange={(e) => setSosMessage(e.target.value)} placeholder="Describe your situation..." />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowSosModal(false)} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button onClick={sendSOS} className="flex-1 btn-danger">Send SOS</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
