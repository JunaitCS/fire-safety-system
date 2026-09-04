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
  building: { name: string; address: string }
  triggerer?: { name: string }
  _count: { occupancies: number; sosRequests: number }
}

export default function ResponderDashboard() {
  const [emergencies, setEmergencies] = useState<Emergency[]>([])
  const [buildings, setBuildings] = useState<any[]>([])
  const [presenceByBuilding, setPresenceByBuilding] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [pendingResolve, setPendingResolve] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
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
      const [emRes, bRes] = await Promise.all([
        api.get('/emergency/active'),
        api.get('/buildings'),
      ])
      setEmergencies(emRes.data)
      setBuildings(bRes.data)
      const counts: Record<string, number> = {}
      await Promise.all(
        bRes.data.map(async (b: any) => {
          try {
            const c = await api.get(`/presence/building/${b.id}/count`)
            counts[b.id] = c.data.count
          } catch {
            counts[b.id] = 0
          }
        })
      )
      setPresenceByBuilding(counts)
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
        <h2 className="font-semibold text-lg mb-3">Active emergencies</h2>
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
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="px-2 py-1 bg-red-600 text-white text-xs font-bold rounded animate-pulse">
                        ACTIVE
                      </span>
                      <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded uppercase">
                        {em.severity}
                      </span>
                      <span className="text-sm text-gray-500 flex items-center gap-1">
                        <ClockIcon className="w-4 h-4" /> {elapsed(em.startTime)}
                      </span>
                    </div>
                    <h3 className="text-xl font-bold">{em.building?.name}</h3>
                    <p className="text-gray-600 flex items-center gap-1 text-sm">
                      <MapPinIcon className="w-4 h-4" /> {em.building?.address}
                    </p>
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
        <h2 className="font-semibold mb-3">Buildings under watch</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {buildings.map((b) => (
            <div key={b.id} className="p-3 border rounded-lg flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{b.name}</p>
                <p className="text-xs text-gray-500">{b.address}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-blue-600">{presenceByBuilding[b.id] ?? 0}</p>
                <p className="text-xs text-gray-500">inside</p>
              </div>
            </div>
          ))}
          {buildings.length === 0 && (
            <p className="text-sm text-gray-500">No public buildings available.</p>
          )}
        </div>
      </div>
    </div>
  )
}
