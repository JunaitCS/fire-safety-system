import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import api, { getCvBase } from '../../utils/api'
import { useSocketStore } from '../../store/socketStore'
import { useSirenStore } from '../../store/sirenStore'
import { PageHeader, LoadingState } from '../../components/ui'
import {
  PlayIcon,
  StopIcon,
  ArrowDownTrayIcon,
  VideoCameraIcon,
  BellAlertIcon,
  CheckCircleIcon,
  ClockIcon,
  UserGroupIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

interface Drill {
  id: string
  startTime: string
  endTime?: string
  status: string
  behaviorSummary?: string | null
  exitStats?: { camera: { id: string; name: string }; exitCount: number; cameraId?: string }[]
}

interface Camera {
  id: string
  name: string
  isExit: boolean
  role?: string
  sourceUrl: string
  lineRatio?: number | null
  direction?: string | null
}

interface Behavior {
  fallIds?: string[]
  runningIds?: string[]
  loiteringIds?: string[]
  crowd?: boolean
  stuck?: boolean
}

type Phase = 'idle' | 'live' | 'wrapup'

export default function DrillManager() {
  const { buildingId } = useParams()
  const [buildings, setBuildings] = useState<any[]>([])
  const [selectedBuilding, setSelectedBuilding] = useState(buildingId || '')
  const [drills, setDrills] = useState<Drill[]>([])
  const [exitCameras, setExitCameras] = useState<Camera[]>([])
  const [activeDrill, setActiveDrill] = useState<Drill | null>(null)
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({})
  const [behaviors, setBehaviors] = useState<Record<string, Behavior>>({})
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const sirenOn = useSirenStore((s) => s.mode === 'drill')
  const startSiren = useSirenStore((s) => s.startDrill)
  const stopSiren = useSirenStore((s) => s.stop)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [checkedIn, setCheckedIn] = useState(0)
  const [lastReport, setLastReport] = useState<any>(null)
  const streamingIdsRef = useRef<Set<string>>(new Set())
  const { socket, joinBuilding } = useSocketStore()

  const phase: Phase = activeDrill ? 'live' : lastReport ? 'wrapup' : 'idle'

  useEffect(() => {
    api.get('/buildings').then((r) => {
      setBuildings(r.data)
      if (!selectedBuilding && r.data.length) setSelectedBuilding(r.data[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedBuilding) {
      fetchDrills()
      fetchExitCameras()
      fetchPresence()
      joinBuilding(selectedBuilding)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBuilding])

  useEffect(() => {
    if (!socket) return
    const onExit = (data: { cameraId: string; count: number }) => {
      setLiveCounts((prev) => ({ ...prev, [data.cameraId]: data.count }))
    }
    socket.on('exit-count', onExit)
    return () => { socket.off('exit-count', onExit) }
  }, [socket])

  // Elapsed timer + behavior polling while live
  useEffect(() => {
    if (!activeDrill) { setElapsed(0); return }
    const t0 = new Date(activeDrill.startTime).getTime()
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    const p = window.setInterval(pollBehaviors, 3000)
    return () => { window.clearInterval(t); window.clearInterval(p) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrill?.id])

  useEffect(() => {
    return () => {
      // Stop camera streams on leave, but keep the global siren running —
      // it stops dynamically on drill-ended / resolve via EmergencyAlert.
      const ids = streamingIdsRef.current
      ids.forEach((id) => {
        fetch(`${getCvBase()}/cameras/${id}/stop`, { method: 'POST' }).catch(() => {})
      })
      streamingIdsRef.current = new Set()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchDrills = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/drills/building/${selectedBuilding}`)
      setDrills(res.data)
      const active = res.data.find((d: Drill) => d.status === 'active')
      setActiveDrill(active || null)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  const fetchExitCameras = async () => {
    try {
      const res = await api.get(`/cameras/building/${selectedBuilding}`)
      // EXIT fleet only — CCTV room cameras never appear in drills.
      setExitCameras(res.data.filter((c: Camera) => c.isExit || (c.role && c.role !== 'CCTV')))
    } catch { setExitCameras([]) }
  }

  const fetchPresence = async () => {
    try {
      const r = await api.get(`/presence/building/${selectedBuilding}/count`)
      setCheckedIn(r.data.count || 0)
    } catch { setCheckedIn(0) }
  }

  const pollBehaviors = async () => {
    const out: Record<string, Behavior> = {}
    for (const cam of exitCameras) {
      try {
        const r = await fetch(`${getCvBase()}/cameras/${cam.id}/stats`)
        const s = await r.json()
        if (s?.behaviors) out[cam.id] = s.behaviors
      } catch {}
    }
    if (Object.keys(out).length) setBehaviors(out)
  }

  // Siren is global (sirenStore) — Resolve from any page stops it via socket.
  // Local helpers removed; startSiren/stopSiren come from the store.

  const startCameraStreams = async (cams: Camera[], drillId?: string) => {
    const ids = new Set<string>()
    for (const cam of cams) {
      try {
        // Reuse the camera's SAVED configuration (source, line position).
        await fetch(`${getCvBase()}/cameras/${cam.id}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: cam.sourceUrl || '0', is_exit: true, drill_id: drillId || null, line_ratio: cam.lineRatio ?? undefined }),
        })
        ids.add(cam.id)
      } catch { console.warn('Could not start stream for', cam.name) }
    }
    streamingIdsRef.current = ids
    setStreamingIds(ids)
  }

  const stopAllStreams = async () => {
    const ids = Array.from(streamingIdsRef.current.size ? streamingIdsRef.current : streamingIds)
    for (const id of ids) {
      try { await fetch(`${getCvBase()}/cameras/${id}/stop`, { method: 'POST' }) } catch {}
    }
    streamingIdsRef.current = new Set()
    setStreamingIds(new Set())
  }

  const startDrill = async () => {
    setError(''); setLastReport(null)
    try {
      const res = await api.post('/drills/start', { buildingId: selectedBuilding })
      setActiveDrill(res.data)
      startSiren()
      await startCameraStreams(exitCameras, res.data.id)
      setNotice('Drill started — occupants notified with PRACTICE alert (amber), exit cameras live.')
      fetchDrills()
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to start drill.')
    }
  }

  const endDrill = async (id: string) => {
    setError('')
    try {
      // Aggregate behavior snapshot for the final report
      const agg = {
        falls: Object.values(behaviors).reduce((s, b) => s + (b.fallIds?.length ? 1 : 0), 0),
        crowdEvents: Object.values(behaviors).filter((b) => b.crowd).length,
        loitering: Object.values(behaviors).reduce((s, b) => s + (b.loiteringIds?.length || 0), 0),
        running: Object.values(behaviors).reduce((s, b) => s + (b.runningIds?.length || 0), 0),
        stuck: Object.values(behaviors).filter((b) => b.stuck).length,
        maxOccupancy: checkedIn,
      }
      await api.post(`/drills/${id}/end`, { behaviorSummary: agg })
      const rep = await api.get(`/drills/${id}/report`).catch(() => null)
      setLastReport(rep?.data || { totalExited: Object.values(liveCounts).reduce((a, b) => a + b, 0), behavior: agg })
      stopSiren()
      await stopAllStreams()
      setActiveDrill(null)
      setLiveCounts({})
      setBehaviors({})
      setNotice('Drill completed — report ready below with behavior summary.')
      fetchDrills()
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to end drill.')
    }
  }

  const exportCsv = (id: string) => {
    setError('')
    api.get(`/drills/${id}/export`, { responseType: 'blob' }).then((r) => {
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url; a.download = `drill-${id}.csv`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }).catch(() => setError('CSV export failed.'))
  }

  const totalExited = Object.values(liveCounts).reduce((a, b) => a + b, 0)
  const progress = checkedIn > 0 ? Math.min(100, Math.round((totalExited / checkedIn) * 100)) : 0
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const behaviorTotals = {
    falls: Object.values(behaviors).reduce((s, b) => s + (b.fallIds?.length || 0), 0),
    running: Object.values(behaviors).reduce((s, b) => s + (b.runningIds?.length || 0), 0),
    loitering: Object.values(behaviors).reduce((s, b) => s + (b.loiteringIds?.length || 0), 0),
    crowd: Object.values(behaviors).filter((b) => b.crowd).length,
    stuck: Object.values(behaviors).filter((b) => b.stuck).length,
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Fire drills — pro console" subtitle="Practice-only (amber). Real fire uses the Fire Emergency console." />

      {/* Phase stepper */}
      <div className="flex items-center gap-2">
        {(['idle', 'live', 'wrapup'] as Phase[]).map((p, i) => (
          <div key={p} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-all ${phase === p ? 'bg-amber-500 text-white scale-105' : 'bg-gray-100 text-gray-500'}`}>
              <span className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center text-[11px]">{i + 1}</span>
              {p === 'idle' ? 'Prepare' : p === 'live' ? 'Live evacuation' : 'Report'}
            </div>
            {i < 2 && <div className="w-8 h-0.5 bg-gray-200 rounded" />}
          </div>
        ))}
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {notice && <div className="p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{notice}</div>}

      <div className="flex items-center gap-3 flex-wrap">
        <select className="input w-52" value={selectedBuilding} onChange={(e) => { setSelectedBuilding(e.target.value); setLastReport(null) }}>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {!activeDrill ? (
          <motion.button whileTap={{ scale: 0.96 }} onClick={startDrill} className="btn-primary flex items-center gap-2">
            <PlayIcon className="w-5 h-5" /> Start Drill
          </motion.button>
        ) : (
          <motion.button whileTap={{ scale: 0.96 }} onClick={() => endDrill(activeDrill.id)} className="btn-danger flex items-center gap-2">
            <StopIcon className="w-5 h-5" /> End Drill & Build Report
          </motion.button>
        )}
        <button onClick={sirenOn ? stopSiren : startSiren}
          className={`px-4 py-2 rounded-lg border flex items-center gap-2 text-sm ${sirenOn ? 'bg-amber-100 border-amber-300 text-amber-700' : 'hover:bg-gray-50'}`}>
          <BellAlertIcon className="w-5 h-5" /> {sirenOn ? 'Stop Drill Tone' : 'Test Drill Tone'}
        </button>
        <Link to="/manager/emergency" className="text-sm text-red-600 underline">Need a real fire? Open Fire Emergency →</Link>
      </div>

      {/* Readiness checklist */}
      {phase === 'idle' && !loading && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card">
          <h3 className="font-semibold mb-3">Pre-flight checklist</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className={`p-3 rounded-lg border ${exitCameras.length ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              {exitCameras.length ? <CheckCircleIcon className="w-5 h-5 text-green-600 mb-1" /> : <ExclamationTriangleIcon className="w-5 h-5 text-red-500 mb-1" />}
              <p className="font-medium">{exitCameras.length} exit cameras</p>
              <p className="text-gray-500 text-xs">{exitCameras.length ? 'Ready for counting' : 'Add cameras + mark as Exit first'}</p>
            </div>
            <div className={`p-3 rounded-lg border ${checkedIn > 0 ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
              <UserGroupIcon className="w-5 h-5 text-blue-500 mb-1" />
              <p className="font-medium">{checkedIn} checked in</p>
              <p className="text-gray-500 text-xs">Occupants receive PRACTICE alerts only</p>
            </div>
            <div className="p-3 rounded-lg border border-gray-200 bg-gray-50">
              <ClockIcon className="w-5 h-5 text-gray-400 mb-1" />
              <p className="font-medium">Amber drill tone</p>
              <p className="text-gray-500 text-xs">Distinct from red fire wail</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* LIVE panel */}
      <AnimatePresence>
        {activeDrill && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="card border-2 border-amber-400 bg-amber-50/50 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 bg-amber-500 text-white text-xs font-bold rounded-full animate-pulse">DRILL ACTIVE — PRACTICE</span>
                <span className="font-mono text-lg font-bold tabular-nums">{mm}:{ss}</span>
                {sirenOn && <span className="text-xs text-amber-700">· tone on</span>}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span><strong className="text-xl">{totalExited}</strong> exited</span>
                <span className="text-gray-500">/ {checkedIn} checked in</span>
              </div>
            </div>
            {/* Progress */}
            <div className="h-3 bg-white rounded-full overflow-hidden border mb-4">
              <motion.div className="h-full bg-gradient-to-r from-amber-400 to-green-500" animate={{ width: `${progress}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
            </div>
            {/* Behavior strip */}
            <div className="flex flex-wrap gap-2 mb-4 text-xs">
              <span className={`px-2 py-1 rounded-full border ${behaviorTotals.falls ? 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-700' : 'bg-white text-gray-500'}`}>Falls: {behaviorTotals.falls}</span>
              <span className={`px-2 py-1 rounded-full border ${behaviorTotals.running ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-white text-gray-500'}`}>Running: {behaviorTotals.running}</span>
              <span className={`px-2 py-1 rounded-full border ${behaviorTotals.loitering ? 'bg-yellow-100 border-yellow-300 text-yellow-700' : 'bg-white text-gray-500'}`}>Loitering: {behaviorTotals.loitering}</span>
              <span className={`px-2 py-1 rounded-full border ${behaviorTotals.crowd ? 'bg-red-100 border-red-300 text-red-700 animate-pulse' : 'bg-white text-gray-500'}`}>Crowd: {behaviorTotals.crowd}</span>
              <span className={`px-2 py-1 rounded-full border ${behaviorTotals.stuck ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-500'}`}>Possibly stuck: {behaviorTotals.stuck}</span>
            </div>
            <h3 className="font-semibold mb-3 flex items-center gap-2"><VideoCameraIcon className="w-5 h-5" /> Live exit cameras</h3>
            {exitCameras.length === 0 ? (
              <p className="text-sm text-gray-500">No exit cameras. <Link to={`/manager/cameras/${selectedBuilding}`} className="text-blue-600 underline">Add cameras</Link></p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {exitCameras.map((cam, i) => {
                  const isLive = streamingIds.has(cam.id)
                  const b = behaviors[cam.id]
                  return (
                    <motion.div key={cam.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="bg-white rounded-lg border overflow-hidden">
                      <div className="bg-gray-900 aspect-video relative">
                        {isLive ? (
                          <img src={`${getCvBase()}/cameras/${cam.id}/feed`} alt={cam.name} className="w-full h-full object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">Connecting…</div>
                        )}
                        {isLive && <div className="absolute top-2 left-2 px-2 py-0.5 bg-amber-500 text-white text-xs rounded flex items-center gap-1"><span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" /> DRILL LIVE</div>}
                      </div>
                      <div className="p-3">
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-sm">{cam.name}</span>
                          <motion.span key={liveCounts[cam.id] ?? 0} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="text-lg font-bold text-amber-600">
                            {liveCounts[cam.id] ?? 0} <span className="text-xs font-normal text-gray-500">exited</span>
                          </motion.span>
                        </div>
                        {b && ((b.fallIds?.length || b.runningIds?.length || b.loiteringIds?.length || b.crowd || b.stuck)) && (
                          <p className="text-xs mt-1 text-gray-600">
                            {[b.fallIds?.length ? `Fall(${b.fallIds.length})` : '', b.runningIds?.length ? `Run(${b.runningIds.length})` : '', b.loiteringIds?.length ? `Loiter(${b.loiteringIds.length})` : '', b.crowd ? 'CROWD' : '', b.stuck ? 'STUCK?' : ''].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wrap-up report */}
      {lastReport && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card border-2 border-green-300 bg-green-50/50">
          <h3 className="font-bold flex items-center gap-2 mb-2"><CheckCircleIcon className="w-5 h-5 text-green-600" /> Drill report ready</h3>
          <p className="text-sm text-gray-600 mb-3">Total exited: <strong>{lastReport.totalExited ?? 0}</strong>
            {lastReport.behavior ? ` · Falls ${lastReport.behavior.falls ?? 0} · Running ${lastReport.behavior.running ?? 0} · Loitering ${lastReport.behavior.loitering ?? 0} · Crowd ${lastReport.behavior.crowdEvents ?? 0} · Stuck ${lastReport.behavior.stuck ?? 0}` : ''}
          </p>
          <button onClick={() => lastReport.drill?.id && exportCsv(lastReport.drill.id)} className="px-3 py-1.5 border rounded-lg text-sm bg-white flex items-center gap-1">
            <ArrowDownTrayIcon className="w-4 h-4" /> Download CSV with behavior summary
          </button>
        </motion.div>
      )}

      {loading ? <LoadingState label="Loading drills…" /> : null}

      {/* History */}
      <div className="card">
        <h2 className="font-semibold mb-4">Drill history</h2>
        {drills.length === 0 ? (
          <p className="text-center py-8 text-gray-500">No drills yet. Start one to track evacuation performance.</p>
        ) : (
          <div className="space-y-3">
            {drills.map((d) => (
              <div key={d.id} className={`flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg border ${d.status === 'active' ? 'border-amber-300 bg-amber-50' : 'bg-gray-50'}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${d.status === 'active' ? 'bg-amber-200 text-amber-800' : 'bg-green-100 text-green-700'}`}>{d.status.toUpperCase()}</span>
                    <span className="text-sm text-gray-600">{new Date(d.startTime).toLocaleString()}</span>
                  </div>
                  {d.exitStats && d.exitStats.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {d.exitStats.map((s, i) => (
                        <span key={i} className="text-xs bg-white border px-2 py-1 rounded">{s.camera?.name || 'Exit'}: {s.exitCount}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {d.status === 'active' && <button onClick={() => endDrill(d.id)} className="btn-danger text-sm py-1.5">End</button>}
                  {d.status === 'completed' && <button onClick={() => exportCsv(d.id)} className="px-3 py-1.5 border rounded-lg text-sm flex items-center gap-1 hover:bg-white"><ArrowDownTrayIcon className="w-4 h-4" /> CSV</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
