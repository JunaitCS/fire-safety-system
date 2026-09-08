import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../utils/api'
import { PageHeader, ConfirmModal } from '../../components/ui'
import { useSocketStore } from '../../store/socketStore'
import {
  BellAlertIcon,
  BuildingOfficeIcon,
  UsersIcon,
  MapPinIcon,
  ArrowRightIcon,
  ExclamationCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'

interface Emergency {
  id: string
  buildingId: string
  severity: string
  startTime: string
  status: string
  type?: string
  title?: string
  building: { id?: string; name: string; address: string; latitude?: number | null; longitude?: number | null; isPublic?: boolean }
  triggerer?: { name: string }
  _count: { occupancies: number; sosRequests: number }
}

const mapsUrl = (address: string, lat?: number | null, lng?: number | null) => {
  if (lat != null && lng != null) return `https://maps.google.com/?q=${lat},${lng}`
  return `https://maps.google.com/?q=${encodeURIComponent(address || '')}`
}
const directionsUrl = (address: string, lat?: number | null, lng?: number | null) => {
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address || '')}`
}

export default function ResponderDashboard() {
  const [emergencies, setEmergencies] = useState<Emergency[]>([])
  const [buildings, setBuildings] = useState<any[]>([])
  const [presenceByBuilding, setPresenceByBuilding] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [pendingResolve, setPendingResolve] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const { socket, connect } = useSocketStore()

  useEffect(() => {
    connect()
    refresh()
    const interval = setInterval(refresh, 8000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!socket) return
    const refreshSoft = () => refresh()
    socket.on('emergency-started', refreshSoft)
    socket.on('building-emergency', refreshSoft)
    socket.on('emergency-resolved', refreshSoft)
    socket.on('sos-received', refreshSoft)
    return () => {
      socket.off('emergency-started', refreshSoft)
      socket.off('building-emergency', refreshSoft)
      socket.off('emergency-resolved', refreshSoft)
      socket.off('sos-received', refreshSoft)
    }
  }, [socket])

  const refresh = async () => {
    try {
      let freshBuildings: any[] = []
      let fires: Emergency[] = []
      // Preferred: single overview (public list + active FIRE details).
      // Falls back to the two legacy calls if the backend is older.
      try {
        const ov = await api.get('/buildings/responder/overview')
        fires = (ov.data.activeEmergencies || []).filter((e: Emergency) => (e.type || 'FIRE') === 'FIRE')
        if (!fires.length) fires = ov.data.activeEmergencies || []
        freshBuildings = ov.data.publicBuildings || []
        // Private buildings currently on fire are fully visible too.
        for (const e of fires) {
          if (e.building && !(e.building as any).isPublic && !freshBuildings.some((b) => b.id === (e.building as any).id)) {
            freshBuildings.push({ ...(e.building as any), _emergencyId: e.id })
          }
        }
      } catch {
        const [emRes, bRes] = await Promise.all([
          api.get('/emergency/active'),
          api.get('/buildings'),
        ])
        fires = (emRes.data || []).filter((e: Emergency) => (e.type || 'FIRE') === 'FIRE')
        freshBuildings = bRes.data || []
      }
      setEmergencies(fires)
      setBuildings(freshBuildings)
      const counts: Record<string, number> = {}
      await Promise.all(
        freshBuildings.map(async (b: any) => {
          try {
            const c = await api.get(`/presence/building/${b.id}/count`)
            counts[b.id] = c.data.count
          } catch {
            counts[b.id] = 0
          }
        })
      )
      setPresenceByBuilding((prev) => ({ ...prev, ...counts }))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const resolveEmergency = async (id: string) => {
    /* confirm via modal */
    try {
      await api.post(`/emergency/${id}/resolve`)
      setPendingResolve(null)
      refresh()
    } catch {
      setActionError('Failed to resolve emergency.')
    }
  }

  const elapsed = (start: string) => {
    const mins = Math.floor((Date.now() - new Date(start).getTime()) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins} min ago`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  const totalSos = emergencies.reduce((s, e) => s + (e._count?.sosRequests || 0), 0)
  const totalPresent = Object.values(presenceByBuilding).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Responder command"
        subtitle="Live emergencies, occupancy and SOS from checked-in occupants."
      />
      {actionError && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{actionError}</div>}
      {pendingResolve && (
        <ConfirmModal
          title="Mark emergency as resolved?"
          message="All occupants in this building will be notified that the incident is over."
          confirmLabel="Mark resolved"
          onCancel={() => setPendingResolve(null)}
          onConfirm={() => resolveEmergency(pendingResolve)}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase">Active fires</p>
          <p className={`text-3xl font-bold ${emergencies.length ? 'text-red-600' : 'text-green-600'}`}>
            {emergencies.length}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase">Pending SOS</p>
          <p className="text-3xl font-bold text-orange-600">{totalSos}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase">People checked in</p>
          <p className="text-3xl font-bold text-blue-600">{totalPresent}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase">Monitored buildings</p>
          <p className="text-3xl font-bold">{buildings.length}</p>
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-lg mb-3">Active fire emergencies</h2>
        <p className="text-xs text-gray-500 mb-3">Private building details unlock only while that building is on fire. Drills never unlock private details.</p>
        {loading ? (
          <div className="card text-center py-12">
            <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
          </div>
        ) : emergencies.length === 0 ? (
          <div className="card text-center py-12">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <BellAlertIcon className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-medium mb-1">All clear</h3>
            <p className="text-gray-600">No active emergencies. Monitoring {buildings.length} buildings.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {emergencies.map((em) => (
              <div key={em.id} className="card border-2 border-red-500 emergency-alert">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-1 bg-red-600 text-white text-xs font-bold rounded animate-pulse">
                    ON FIRE NOW
                  </span>
                  <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded uppercase">
                    {em.severity}
                  </span>
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <ClockIcon className="w-4 h-4" /> {elapsed(em.startTime)}
                  </span>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex-1 min-w-[200px]">
                    <h3 className="text-xl font-bold">{em.building?.name} — on fire</h3>
                    <p className="text-gray-700 flex items-center gap-1 text-sm font-medium">
                      <MapPinIcon className="w-4 h-4 text-red-600" /> {em.building?.address}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <a
                        href={directionsUrl(em.building?.address, (em.building as any)?.latitude, (em.building as any)?.longitude)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg"
                      >
                        Get directions
                      </a>
                      <a
                        href={mapsUrl(em.building?.address, (em.building as any)?.latitude, (em.building as any)?.longitude)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50"
                      >
                        View on map
                      </a>
                    </div>
                    <div className="flex gap-4 mt-3">
                      <div className="text-center px-3 py-2 bg-red-50 rounded-lg">
                        <p className="text-xl font-bold text-red-600">{em._count?.sosRequests || 0}</p>
                        <p className="text-xs text-red-700">SOS</p>
                      </div>
                      <div className="text-center px-3 py-2 bg-blue-50 rounded-lg">
                        <p className="text-xl font-bold text-blue-600">{presenceByBuilding[em.buildingId] ?? '—'}</p>
                        <p className="text-xs text-blue-700">Checked in</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Link
                      to={`/responder/emergency/${em.id}`}
                      className="btn-primary flex items-center justify-center gap-2"
                    >
                      Open incident <ArrowRightIcon className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => setPendingResolve(em.id)}
                      className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm"
                    >
                      Mark resolved
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-1">Buildings — viewed separately</h2>
        <p className="text-xs text-gray-500 mb-3">Public buildings show address + map. Private buildings stay locked unless that building is on fire above.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {buildings.map((b) => {
            const onFire = emergencies.some((e) => e.buildingId === b.id)
            const isOpen = !!expanded[b.id]
            const locked = b.isPublic === false && !onFire
            return (
              <div key={b.id} className={`p-3 border rounded-lg ${onFire ? 'border-red-400 bg-red-50/50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <BuildingOfficeIcon className="w-5 h-5 text-gray-400 shrink-0" />
                    <p className="font-medium text-sm truncate">{b.name}</p>
                  </div>
                  {onFire
                    ? <span className="text-[11px] font-bold text-white bg-red-600 px-2 py-0.5 rounded">ON FIRE</span>
                    : locked
                      ? <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Private · locked</span>
                      : <span className="text-[11px] font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded">Public</span>}
                </div>
                {locked ? (
                  <p className="text-xs text-gray-500 mt-2">Address hidden — unlocks during an active fire at this building.</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 mt-1">{b.address}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <a href={mapsUrl(b.address, b.latitude, b.longitude)} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">Map</a>
                      <a href={directionsUrl(b.address, b.latitude, b.longitude)} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">Directions</a>
                      <button onClick={() => setExpanded((p) => ({ ...p, [b.id]: !p[b.id] }))} className="text-xs text-gray-500 underline ml-auto">
                        {isOpen ? 'Hide' : 'Details'}
                      </button>
                    </div>
                    {isOpen && (
                      <div className="text-xs text-gray-600 mt-2 space-y-1">
                        <p>{b._count?.floors ?? 0} floors · {b._count?.cameras ?? 0} cameras</p>
                        <p className="flex items-center gap-1"><UsersIcon className="w-3.5 h-3.5" /> {presenceByBuilding[b.id] ?? 0} inside now</p>
                        {(b.latitude != null && b.longitude != null) && <p className="font-mono">📍 {b.latitude}, {b.longitude}</p>}
                      </div>
                    )}
                  </>
                )}
                {!locked && (
                  <div className="text-right mt-1">
                    <p className="text-lg font-bold text-blue-600">{presenceByBuilding[b.id] ?? 0}</p>
                    <p className="text-xs text-gray-500">inside</p>
                  </div>
                )}
              </div>
            )
          })}
          {buildings.length === 0 && (
            <p className="text-sm text-gray-500">No public buildings available.</p>
          )}
        </div>
      </div>
    </div>
  )
}
