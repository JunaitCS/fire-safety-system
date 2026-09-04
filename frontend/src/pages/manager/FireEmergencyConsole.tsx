import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api, { getCvBase } from '../../utils/api'
import { useSocketStore } from '../../store/socketStore'
import { useSirenStore } from '../../store/sirenStore'
import { PageHeader, LoadingState, ConfirmModal } from '../../components/ui'
import {
  FireIcon,
  BellAlertIcon,
  VideoCameraIcon,
  CpuChipIcon,
  TruckIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'

interface Feed {
  id: string
  name: string
  floorName?: string | null
  isExit: boolean
  feedUrl: string
}

export default function FireEmergencyConsole() {
  const [buildings, setBuildings] = useState<any[]>([])
  const [selected, setSelected] = useState('')
  const [active, setActive] = useState<any>(null)
  const [feeds, setFeeds] = useState<Feed[]>([])
  const [feedsCut, setFeedsCut] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmFire, setConfirmFire] = useState(false)
  const [confirmResolve, setConfirmResolve] = useState(false)
  const [title, setTitle] = useState('Fire emergency')
  const [severity, setSeverity] = useState('critical')
  const [description, setDescription] = useState('')
  const sirenOn = useSirenStore((s) => s.mode === 'fire')
  const startFireSiren = useSirenStore((s) => s.startFire)
  const stopFireSiren = useSirenStore((s) => s.stop)
  const [elapsed, setElapsed] = useState(0)
  const [hwMsg, setHwMsg] = useState('')
  const { socket, joinBuilding } = useSocketStore()

  useEffect(() => {
    api.get('/buildings').then((r) => {
      setBuildings(r.data || [])
      if (r.data?.length) setSelected(r.data[0].id)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (selected) {
      fetchActive()
      joinBuilding(selected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  useEffect(() => {
    if (!socket) return
    const onFire = (d: any) => {
      if (!selected || d.buildingId === selected) {
        setActive((prev: any) => prev || d)
        setFeedsCut(false)
        startFireSiren()
        if (d.id || d.emergencyId) fetchFeeds(d.id || d.emergencyId)
      }
    }
    const onResolve = (d: any) => {
      setActive((prev: any) => {
        if (!prev) return prev
        const pid = prev.id || prev.emergencyId
        return pid === d.emergencyId ? null : prev
      })
      // STRICT auto-cut: feeds disappear the moment fire resolves
      setFeeds([])
      setFeedsCut(true)
      stopFireSiren()
    }
    socket.on('fire-started', onFire)
    socket.on('emergency-started', onFire)
    socket.on('building-emergency', onFire)
    socket.on('fire-resolved', onResolve)
    socket.on('emergency-resolved', onResolve)
    return () => {
      socket.off('fire-started', onFire)
      socket.off('emergency-started', onFire)
      socket.off('building-emergency', onResolve)
      socket.off('fire-resolved', onResolve)
      socket.off('emergency-resolved', onResolve)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, selected])

  useEffect(() => {
    if (!active) { setElapsed(0); return }
    const t0 = new Date(active.startTime || Date.now()).getTime()
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => window.clearInterval(t)
  }, [active])

  // Siren is global — EmergencyAlert stops it on resolve from ANY page.

  const fetchActive = async () => {
    setLoading(true)
    try {
      const r = await api.get('/emergency/active', { params: { buildingId: selected, type: 'FIRE' } })
      const list = r.data || []
      const a = list[0] || null
      setActive(a)
      if (a) fetchFeeds(a.id)
      else { setFeeds([]); setFeedsCut(false) }
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  const fetchFeeds = async (emergencyId: string) => {
    try {
      const r = await api.get(`/emergency/${emergencyId}/feeds`)
      setFeeds(r.data.feeds || [])
      setFeedsCut(false)
    } catch (e: any) {
      if (e.response?.status === 410) { setFeeds([]); setFeedsCut(true) }
    }
  }

  // Siren tones live in sirenStore (global) — distinct fire wail vs drill beep.

  const triggerFire = async () => {
    setConfirmFire(false); setError('')
    try {
      const r = await api.post('/emergency/trigger', { buildingId: selected, severity, title, description, type: 'FIRE' })
      setActive(r.data)
      setNotice('FIRE EMERGENCY triggered — checked-in occupants + responders alerted (red). Room CCTV unlocked for this incident only.')
      startFireSiren()
      fetchFeeds(r.data.id)
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to trigger fire emergency.')
    }
  }

  const resolveFire = async () => {
    if (!active) return
    setConfirmResolve(false)
    try {
      await api.post(`/emergency/${active.id || active.emergencyId}/resolve`)
      setActive(null); setFeeds([]); setFeedsCut(true); stopFireSiren()
      setNotice('Fire resolved — CCTV feeds cut automatically for privacy.')
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to resolve.')
    }
  }

  const hwPlaceholder = async (kind: 'auto' | 'robot') => {
    if (!active) { setHwMsg('Trigger a fire first — hardware modules attach to an active incident.'); return }
    const id = active.id || active.emergencyId
    const url = kind === 'auto' ? `/emergency/${id}/auto-detect/config` : `/emergency/${id}/robot/dispatch`
    const r = await api.post(url).catch(() => null)
    setHwMsg(r?.data?.message || 'Hardware module coming soon.')
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <div className="space-y-6">
      <PageHeader title="Fire emergency command" subtitle="Real incidents only (red). Drills live in the amber Drill console." />
      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {notice && <div className="p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{notice}</div>}

      {confirmFire && (
        <ConfirmModal title="Trigger REAL fire emergency?"
          message="All checked-in occupants get a RED evacuation alert + sound. Responders are paged. Room CCTV unlocks for managers/responders only, for this incident only."
          confirmLabel="Trigger FIRE emergency" danger
          onCancel={() => setConfirmFire(false)} onConfirm={triggerFire} />
      )}
      {confirmResolve && (
        <ConfirmModal title="Resolve fire incident?" message="Occupants are notified. All CCTV feeds cut immediately for privacy."
          confirmLabel="Resolve incident" onCancel={() => setConfirmResolve(false)} onConfirm={resolveFire} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-52" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {!active ? (
          <motion.button whileTap={{ scale: 0.96 }} onClick={() => setConfirmFire(true)}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl flex items-center gap-2 shadow-lg shadow-red-200">
            <FireIcon className="w-5 h-5" /> TRIGGER FIRE EMERGENCY
          </motion.button>
        ) : (
          <motion.button whileTap={{ scale: 0.96 }} onClick={() => setConfirmResolve(true)} className="btn-primary">
            Resolve incident
          </motion.button>
        )}
        <button onClick={sirenOn ? stopFireSiren : startFireSiren}
          className={`px-4 py-2 rounded-lg border flex items-center gap-2 text-sm ${sirenOn ? 'bg-red-100 border-red-300 text-red-700' : 'hover:bg-gray-50'}`}>
          <BellAlertIcon className="w-5 h-5" /> {sirenOn ? 'Stop Fire Wail' : 'Test Fire Wail'}
        </button>
      </div>

      {!active && (
        <div className="card grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Incident title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fire emergency" />
          </div>
          <div>
            <label className="label">Severity</label>
            <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="label">Details for responders</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Smoke on floor 2, stairwell B…" />
          </div>
        </div>
      )}

      {/* Hardware placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card p-4 opacity-80">
          <h3 className="font-semibold flex items-center gap-2"><CpuChipIcon className="w-5 h-5 text-gray-400" /> Automatic fire detection <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">COMING SOON</span></h3>
          <p className="text-xs text-gray-500 mt-1">Smoke/heat sensor auto-trigger will plug in here. Manual trigger remains authoritative.</p>
          <button onClick={() => hwPlaceholder('auto')} className="mt-2 text-xs px-3 py-1.5 border rounded-lg">Check module status</button>
        </div>
        <div className="card p-4 opacity-80">
          <h3 className="font-semibold flex items-center gap-2"><TruckIcon className="w-5 h-5 text-gray-400" /> Responder robot <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">COMING SOON</span></h3>
          <p className="text-xs text-gray-500 mt-1">Dispatch + live robot feed will appear here after hardware integration.</p>
          <button onClick={() => hwPlaceholder('robot')} className="mt-2 text-xs px-3 py-1.5 border rounded-lg">Check module status</button>
        </div>
      </div>
      {hwMsg && <div className="p-3 bg-gray-50 border text-sm text-gray-600 rounded-lg">{hwMsg}</div>}

      {loading && <LoadingState label="Loading fire state…" />}

      <AnimatePresence>
        {active && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="card border-2 border-red-500 bg-red-50/60">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 bg-red-600 text-white text-xs font-bold rounded-full animate-pulse">FIRE ACTIVE — REAL</span>
                <span className="font-mono text-lg font-bold tabular-nums flex items-center gap-1"><ClockIcon className="w-4 h-4" />{mm}:{ss}</span>
                <span className="text-xs uppercase font-bold text-red-700">{active.severity}</span>
              </div>
              <span className="text-xs text-gray-500">Occupants see RED banner · Drills are AMBER elsewhere</span>
            </div>
            <p className="text-sm text-gray-700 mb-4">{active.title || 'Fire emergency'} — room CCTV below is visible to <strong>managers/responders only, only while ACTIVE</strong>. Occupants can never see these feeds.</p>

            {feeds.length > 0 ? (
              <>
                <h3 className="font-semibold mb-2 flex items-center gap-2"><VideoCameraIcon className="w-5 h-5" /> Room & exit cameras — find stuck people ({feeds.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {feeds.map((f, i) => (
                    <motion.div key={f.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.4) }}
                      className="bg-white rounded-lg border overflow-hidden">
                      <div className="bg-gray-900 aspect-video relative">
                        <img src={f.feedUrl.startsWith('http') ? f.feedUrl : `${getCvBase()}/cameras/${f.id}/feed`}
                          alt={f.name} className="w-full h-full object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.25' }} />
                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-red-600 text-white text-xs rounded flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" /> FIRE LIVE
                        </div>
                      </div>
                      <div className="p-2.5 text-sm flex justify-between">
                        <span className="font-medium">{f.name}</span>
                        <span className="text-xs text-gray-500">{f.floorName || ''}{f.isExit ? ' · Exit' : ''}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </>
            ) : (
              <div className="p-4 bg-white border rounded-lg text-sm text-gray-600">
                {feedsCut
                  ? <span className="flex items-center gap-2"><CheckCircleIcon className="w-5 h-5 text-green-600" /> Feeds cut — incident resolved. Privacy preserved.</span>
                  : 'No camera feeds yet — add room cameras so responders can check for stuck occupants during fire.'}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
