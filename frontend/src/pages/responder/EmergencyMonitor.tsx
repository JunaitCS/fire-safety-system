import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api, { getCvBase } from '../../utils/api'
import { ConfirmModal } from '../../components/ui'
import { useSocketStore } from '../../store/socketStore'
import {
  ArrowLeftIcon,
  ExclamationCircleIcon,
  CheckIcon,
  UsersIcon,
  PhoneIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline'

export default function EmergencyMonitor() {
  const { emergencyId } = useParams()
  const [emergency, setEmergency] = useState<any>(null)
  const [presence, setPresence] = useState<any[]>([])
  const [feeds, setFeeds] = useState<any[]>([])
  const [feedsCut, setFeedsCut] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirmResolve, setConfirmResolve] = useState(false)
  const { socket, joinEmergency } = useSocketStore()

  const load = async () => {
    if (!emergencyId) return
    try {
      const r = await api.get(`/emergency/${emergencyId}`)
      setEmergency(r.data)
      if (r.data.buildingId) {
        const p = await api.get(`/presence/building/${r.data.buildingId}`)
        setPresence(p.data)
        joinEmergency(emergencyId)
      }
      // Fire-only CCTV: fetch gated feeds when ACTIVE fire, auto-cut otherwise.
      if (r.data?.status === 'ACTIVE' && (r.data?.type || 'FIRE') === 'FIRE') {
        try {
          const f = await api.get(`/emergency/${emergencyId}/feeds`)
          setFeeds(f.data.feeds || [])
          setFeedsCut(false)
        } catch (e: any) {
          if (e.response?.status === 410) { setFeeds([]); setFeedsCut(true) }
        }
      } else {
        setFeeds([]); setFeedsCut(true)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [emergencyId])

  useEffect(() => {
    if (!socket) return
    const reload = () => load()
    const onFireResolved = (d: any) => {
      if (!emergencyId || d.emergencyId === emergencyId) {
        setFeeds([]); setFeedsCut(true)
      }
      load()
    }
    socket.on('sos-received', reload)
    socket.on('new-sos', reload)
    socket.on('sos-updated', reload)
    socket.on('occupant-checked-in', reload)
    socket.on('fire-resolved', onFireResolved)
    socket.on('emergency-resolved', onFireResolved)
    return () => {
      socket.off('sos-received', reload)
      socket.off('new-sos', reload)
      socket.off('sos-updated', reload)
      socket.off('occupant-checked-in', reload)
      socket.off('fire-resolved', onFireResolved)
      socket.off('emergency-resolved', onFireResolved)
    }
  }, [socket])

  const ackSos = async (id: string) => {
    await api.post(`/sos/${id}/acknowledge`)
    load()
  }

  const resolveSos = async (id: string) => {
    await api.post(`/sos/${id}/resolve`)
    load()
  }

  const resolveAll = async () => {
    setConfirmResolve(false)
    await api.post(`/emergency/${emergencyId}/resolve`)
    load()
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (!emergency) {
    return <div className="card text-center py-12">Incident not found</div>
  }

  const pendingSos = (emergency.sosRequests || []).filter((s: any) => s.status === 'PENDING' || s.status === 'ACKNOWLEDGED')

  return (
    <div className="space-y-6">
      {confirmResolve && (
        <ConfirmModal
          title="Resolve this incident?"
          message="This notifies all occupants in the building that the emergency is over."
          confirmLabel="Resolve incident"
          onCancel={() => setConfirmResolve(false)}
          onConfirm={resolveAll}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/responder" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeftIcon className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 text-xs font-bold rounded ${emergency.status === 'ACTIVE' ? 'bg-red-600 text-white' : 'bg-green-100 text-green-700'}`}>
                {emergency.status}
              </span>
              <span className={`px-2 py-0.5 text-xs font-bold rounded ${(emergency.type || 'FIRE') === 'FIRE' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                {(emergency.type || 'FIRE') === 'FIRE' ? 'REAL FIRE' : 'DRILL'}
              </span>
              <h1 className="text-xl font-bold">{emergency.building?.name}</h1>
            </div>
            <p className="text-sm text-gray-600 flex items-center gap-1">
              <MapPinIcon className="w-4 h-4" /> {emergency.building?.address}
            </p>
          </div>
        </div>
        {emergency.status === 'ACTIVE' && (
          <button onClick={() => setConfirmResolve(true)} className="btn-primary">
            Resolve incident
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4 text-center">
          <PhoneIcon className="w-5 h-5 text-red-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-red-600">{pendingSos.length}</p>
          <p className="text-xs text-gray-500">Open SOS</p>
        </div>
        <div className="card p-4 text-center">
          <UsersIcon className="w-5 h-5 text-blue-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-blue-600">{presence.length}</p>
          <p className="text-xs text-gray-500">Checked in</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold">{emergency.building?.cameras?.length || 0}</p>
          <p className="text-xs text-gray-500">Cameras</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold uppercase text-orange-600">{emergency.severity}</p>
          <p className="text-xs text-gray-500">Severity</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <ExclamationCircleIcon className="w-5 h-5 text-red-500" /> SOS queue
          </h2>
          {pendingSos.length === 0 ? (
            <p className="text-sm text-gray-500">No open SOS requests</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {pendingSos.map((s: any) => (
                <div key={s.id} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="font-medium">{s.user?.name || 'Anonymous'}</p>
                      {s.user?.phone && <p className="text-xs text-gray-600">{s.user.phone}</p>}
                      <p className="text-sm text-gray-700 mt-1">
                        <strong>Location:</strong> {s.location || 'Not specified'}
                      </p>
                      {s.message && <p className="text-sm mt-1">{s.message}</p>}
                      <p className="text-xs text-gray-400 mt-1">{new Date(s.timestamp).toLocaleTimeString()} · {s.status}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      {s.status === 'PENDING' && (
                        <button onClick={() => ackSos(s.id)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">
                          Ack
                        </button>
                      )}
                      <button onClick={() => resolveSos(s.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded flex items-center gap-1">
                        <CheckIcon className="w-3 h-3" /> Done
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-blue-500" /> People still checked in
          </h2>
          {presence.length === 0 ? (
            <p className="text-sm text-gray-500">No active check-ins</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {presence.map((p) => (
                <div key={p.id} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg text-sm">
                  <div>
                    <p className="font-medium">{p.user?.name || p.guestName || 'Guest'}</p>
                    <p className="text-xs text-gray-500">
                      {p.floorHint || 'Floor unknown'}
                      {(p.user?.phone || p.guestPhone) && ` · ${p.user?.phone || p.guestPhone}`}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(p.checkedInAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-1">Room cameras — live during ACTIVE fire only</h2>
        <p className="text-xs text-gray-500 mb-3">Managers/responders only. Auto-cut on resolve. Occupants can never see these feeds.</p>
        {emergency.status === 'ACTIVE' && (emergency.type || 'FIRE') === 'FIRE' && feeds.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {feeds.map((c: any) => (
              <div key={c.id} className="bg-gray-900 rounded-lg overflow-hidden">
                <div className="aspect-video relative">
                  <img src={c.feedUrl?.startsWith('http') ? c.feedUrl : `${getCvBase()}/cameras/${c.id}/feed`}
                    alt={c.name} className="w-full h-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.25' }} />
                  <div className="absolute top-2 left-2 px-2 py-0.5 bg-red-600 text-white text-xs rounded flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" /> FIRE LIVE
                  </div>
                </div>
                <p className="text-white text-xs p-2">{c.name}{c.floorName ? ` · ${c.floorName}` : ''}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            {feedsCut || emergency.status !== 'ACTIVE'
              ? 'Feeds cut — no active fire. Privacy preserved.'
              : 'No room feeds for this incident yet.'}
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          {(emergency.building?.cameras || []).map((c: any) => (
            <div key={c.id} className="p-3 bg-gray-50 rounded-lg text-sm">
              <p className="font-medium">{c.name}</p>
              {c.isExit && <span className="text-xs text-orange-600">Exit camera</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
