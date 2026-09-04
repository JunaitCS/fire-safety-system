import { useEffect, useState } from 'react'
import { useSocketStore } from '../store/socketStore'
import { useSirenStore } from '../store/sirenStore'
import { BellAlertIcon, XMarkIcon, FireIcon, SpeakerXMarkIcon } from '@heroicons/react/24/outline'

interface EmergencyAlertData {
  id?: string
  emergencyId?: string
  buildingId: string
  buildingName?: string
  building?: { name?: string }
  severity: string
  type?: string
  title?: string
  message: string
  startTime: string
}

const normId = (a: EmergencyAlertData) => a.id || a.emergencyId || ''
const kindOf = (a: EmergencyAlertData): 'FIRE' | 'DRILL' => {
  const t = (a.type || '').toUpperCase()
  if (t === 'FIRE' || t === 'DRILL') return t as 'FIRE' | 'DRILL'
  return /drill/i.test(a.title || a.message || '') ? 'DRILL' : 'FIRE'
}

export default function EmergencyAlert({ filterBuildingId }: { filterBuildingId?: string } = {}) {
  const [alerts, setAlerts] = useState<EmergencyAlertData[]>([])
  const { socket } = useSocketStore()
  const sirenMode = useSirenStore((s) => s.mode)
  const stopSiren = useSirenStore((s) => s.stop)

  useEffect(() => {
    if (!socket) return
    const siren = useSirenStore.getState()

    // On scoped views (e.g. the public occupant page for one building),
    // only react to that building's alerts — never a neighbour's.
    const matches = (data: { buildingId?: string }) =>
      !filterBuildingId || (!!data?.buildingId && data.buildingId === filterBuildingId)

    const add = (data: EmergencyAlertData) => {
      if (!matches(data)) return
      setAlerts(prev => {
        const id = normId(data)
        if (prev.some(a => normId(a) === id)) return prev
        return [...prev, { ...data, id }]
      })
      // Global siren follows the alert kind — one place, every page hears/stops together.
      if (kindOf(data) === 'FIRE') siren.startFire()
      else siren.startDrill()
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const kind = kindOf(data)
        new Notification(kind === 'FIRE' ? 'FIRE EMERGENCY — EVACUATE' : 'FIRE DRILL — PRACTICE', {
          body: data.message || 'See dashboard for instructions.',
          requireInteraction: kind === 'FIRE',
        })
      }
    }
    const remove = (data: { emergencyId: string }) => {
      setAlerts(prev => prev.filter(a => normId(a) !== data.emergencyId))
      // Dynamic stop: resolving ANY incident silences the siren app-wide, no refresh needed.
      siren.stop()
    }
    const onDrillStart = (data: any) => {
      if (!matches(data || {})) return
      useSirenStore.getState().startDrill()
      if (data?.drillId) add({ id: data.drillId, buildingId: data.buildingId || '', severity: 'medium', type: 'DRILL', title: 'Fire drill', message: data.message || 'Practice evacuation.', startTime: data.startTime || new Date().toISOString() })
    }
    const onDrillEnd = (data: { drillId?: string; buildingId?: string } = {}) => {
      if (filterBuildingId && data.buildingId && data.buildingId !== filterBuildingId) return
      useSirenStore.getState().stop()
      setAlerts((prev) => prev.filter((a) => {
        if (kindOf(a) !== 'DRILL') return true
        // Drop drills for the ended building (or unknown-scope ones, which
        // can only exist on unfiltered views from legacy payloads).
        if (!data.buildingId) return false
        return !!a.buildingId && a.buildingId !== data.buildingId
      }))
    }
    // Distinct: fire-* (real, red) vs drill-* (practice, amber). Legacy kept.
    socket.on('fire-started', add)
    socket.on('fire-started-global', add)
    socket.on('drill-alert', add)
    socket.on('drill-alert-global', add)
    socket.on('emergency-started', add)
    socket.on('building-emergency', add)
    socket.on('drill-started', onDrillStart)

    socket.on('fire-resolved', remove)
    socket.on('fire-resolved-global', remove)
    socket.on('emergency-resolved', remove)
    socket.on('drill-ended', onDrillEnd)
    socket.on('drill-ended-global', onDrillEnd)

    return () => {
      socket.off('fire-started', add)
      socket.off('fire-started-global', add)
      socket.off('drill-alert', add)
      socket.off('drill-alert-global', add)
      socket.off('emergency-started', add)
      socket.off('building-emergency', add)
      socket.off('drill-started', onDrillStart)
      socket.off('fire-resolved', remove)
      socket.off('fire-resolved-global', remove)
      socket.off('emergency-resolved', remove)
      socket.off('drill-ended', onDrillEnd)
      socket.off('drill-ended-global', onDrillEnd)
    }
  }, [socket, filterBuildingId])

  const dismissAlert = (alertId: string | undefined) => {
    if (!alertId) return
    setAlerts(prev => prev.filter(a => normId(a) !== alertId))
  }

  if (alerts.length === 0) return null

  return (
    <div className="sticky top-0 z-40 space-y-2 p-3 pointer-events-none">
      {alerts.map((alert, idx) => {
        const kind = kindOf(alert)
        const fire = kind === 'FIRE'
        return (
          <div
            key={normId(alert) || idx}
            role="alert"
            className={`max-w-4xl mx-auto text-white rounded-xl shadow-lg border p-4 pointer-events-auto ${fire ? 'bg-red-700 border-red-800 animate-pulse' : 'bg-amber-500 border-amber-600'}`}
          >
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
                {fire ? <FireIcon className="w-5 h-5" /> : <BellAlertIcon className="w-5 h-5" />}
              </span>
              <div className="flex-1">
                <h3 className="font-bold text-base tracking-tight">
                  {fire ? 'FIRE EMERGENCY — real, evacuate now' : 'FIRE DRILL — practice only'}
                </h3>
                <p className={`mt-1 text-sm ${fire ? 'text-red-50' : 'text-amber-50'}`}>{alert.message}</p>
                <p className={`text-xs mt-2 ${fire ? 'text-red-200' : 'text-amber-100'}`}>
                  {alert.buildingName || alert.building?.name || 'Affected building'} · Severity: {alert.severity || 'high'} · {alert.startTime ? new Date(alert.startTime).toLocaleTimeString() : ''}
                </p>
              </div>
              <button onClick={() => dismissAlert(normId(alert))} className={`p-1 rounded ${fire ? 'hover:bg-red-600' : 'hover:bg-amber-600'}`}>
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            {sirenMode && (
              <button onClick={stopSiren} className="mt-2 flex items-center gap-1 text-xs underline opacity-90">
                <SpeakerXMarkIcon className="w-4 h-4" /> Mute {sirenMode === 'fire' ? 'fire wail' : 'drill tone'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
