import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import api, { getCvBase } from '../../utils/api'
import { PageHeader, LoadingState, ErrorState, EmptyState, ConfirmModal } from '../../components/ui'
import {
  VideoCameraIcon,
  PlayIcon,
  StopIcon,
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline'

type CameraType = 'WEBCAM' | 'USB' | 'IP' | 'PHONE'

interface Camera {
  id: string
  name: string
  type: CameraType
  sourceUrl: string
  isActive: boolean
  isExit: boolean
  role?: string
  lineRatio?: number | null
  direction?: string | null
  floor?: { name: string }
  _count?: { detections: number }
}

const SOURCE_HINTS: Record<CameraType, { placeholder: string; hint: string }> = {
  WEBCAM: { placeholder: '0', hint: 'Laptop webcam index — usually 0 or 1.' },
  USB: { placeholder: '1', hint: 'USB camera index — try 1, 2, 3.' },
  IP: { placeholder: 'rtsp://user:pass@192.168.1.64/stream', hint: 'Full RTSP/HTTP stream URL from your NVR.' },
  PHONE: { placeholder: 'http://192.168.1.5:8080/video', hint: 'IP Webcam app URL (Android) or EpocCam (iOS).' },
}

export default function CameraManager() {
  const { buildingId } = useParams()
  const [cameras, setCameras] = useState<Camera[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [step, setStep] = useState(1)
  const [floors, setFloors] = useState<any[]>([])
  const [streaming, setStreaming] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Camera | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'WEBCAM' as CameraType,
    sourceUrl: '0',
    role: 'EXIT' as 'EXIT' | 'CCTV' | 'BOTH',
    floorId: '',
    direction: 'both',
    lineRatio: 0.62,
  })

  useEffect(() => {
    if (buildingId) {
      fetchCameras()
      fetchFloors()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId])

  const fetchCameras = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/cameras/building/${buildingId}`)
      setCameras(res.data)
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not load cameras.')
    } finally {
      setLoading(false)
    }
  }

  const fetchFloors = async () => {
    try {
      const res = await api.get(`/floors/building/${buildingId}`)
      setFloors(res.data)
      if (res.data.length) setForm((p) => ({ ...p, floorId: res.data[0].id }))
    } catch (e) { console.error(e) }
  }

  const openWizard = () => {
    setFormError(''); setTestState('idle'); setTestMsg(''); setStep(1); setShowAdd(true)
  }

  const testSource = async () => {
    setTestState('testing'); setTestMsg('')
    try {
      // Local preview for webcam types
      if ((form.type === 'WEBCAM' || form.type === 'USB') && /^\d+$/.test(form.sourceUrl.trim())) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: true })
          s.getTracks().forEach((t) => t.stop())
          setTestState('ok'); setTestMsg('Local camera permission OK. Save to enable CV counting.')
          return
        } catch { /* fall through to CV probe */ }
      }
      const cvHealth = await fetch(`${getCvBase()}/health`).then((r) => r.json()).catch(() => null)
      if (cvHealth?.model_loaded !== false && cvHealth?.status) {
        setTestState('ok')
        setTestMsg(`CV service reachable (${cvHealth.version || 'ok'}). Stream will be verified after save.`)
      } else {
        setTestState('fail')
        setTestMsg(`CV service unreachable at ${getCvBase()}. Start python app.py first — you can still save.`)
      }
    } catch {
      setTestState('fail'); setTestMsg('Test failed — check the source and try again.')
    }
  }

  const addCamera = async () => {
    setFormError('')
    if (!form.name.trim()) { setFormError('Camera name is required.'); setStep(1); return }
    if (!form.sourceUrl.trim()) { setFormError('Source is required.'); setStep(1); return }
    try {
      const isExit = form.role !== 'CCTV';
      await api.post('/cameras', { ...form, isExit, name: form.name.trim(), buildingId, floorId: form.floorId || undefined })
      setShowAdd(false)
      setForm({ name: '', type: 'WEBCAM', sourceUrl: '0', role: 'EXIT', floorId: floors[0]?.id || '', direction: 'both', lineRatio: 0.62 })
      fetchCameras()
    } catch (e: any) {
      const detail = e.response?.data?.detail ? ` (${e.response.data.detail})` : '';
      setFormError((e.response?.data?.error || 'Failed to add camera.') + detail);
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await api.delete(`/cameras/${pendingDelete.id}`)
      setPendingDelete(null)
      fetchCameras()
    } catch {
      setError('Failed to delete camera.')
      setPendingDelete(null)
    }
  }

  const toggleActive = async (cam: Camera) => {
    try {
      await api.put(`/cameras/${cam.id}`, { isActive: !cam.isActive })
      fetchCameras()
    } catch { setError('Failed to update camera status.') }
  }

  const startStream = async (cam: Camera) => {
    setError('')
    // CCTV room cameras stay locked here — they stream only during an ACTIVE fire
    // via the Fire console / gated feeds endpoint.
    if ((cam.role || (cam.isExit ? 'EXIT' : 'CCTV')) === 'CCTV') {
      setError('Room CCTV is locked for privacy — it becomes visible only during an ACTIVE fire in the Fire Emergency console.')
      return
    }
    try {
      // Saved configuration is reused: source + exit line + direction from building settings.
      await fetch(`${getCvBase()}/cameras/${cam.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: cam.sourceUrl, is_exit: cam.isExit, line_ratio: cam.lineRatio ?? 0.62, direction: cam.direction || 'both' }),
      })
      setStreaming((p) => new Set([...p, cam.id]))
    } catch {
      setError('Failed to start stream. Is the Python CV service running on ' + getCvBase() + '?')
    }
  }

  const stopStream = async (id: string) => {
    try {
      await fetch(`${getCvBase()}/cameras/${id}/stop`, { method: 'POST' })
      setStreaming((p) => { const n = new Set(p); n.delete(id); return n })
    } catch (e) { console.error(e) }
  }

  const canNext1 = form.name.trim().length > 0 && form.sourceUrl.trim().length > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Camera management"
        subtitle="Exit cameras run drills & evacuation counts. Room CCTV stays locked and opens only during an ACTIVE fire."
        action={<button onClick={openWizard} className="btn-primary"><PlusIcon className="w-5 h-5" /> Add Camera</button>}
      />
      {error && <ErrorState message={error} />}
      {loading ? <LoadingState label="Loading cameras…" /> : cameras.length === 0 ? (
        <EmptyState icon={<VideoCameraIcon className="w-14 h-14" />} title="No cameras configured"
          hint="Add exit and monitoring cameras for this building."
          action={<button onClick={openWizard} className="btn-primary mt-4">Add Camera</button>} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {cameras.map((cam) => {
            const role = cam.role || (cam.isExit ? 'EXIT' : 'CCTV')
            const locked = role === 'CCTV'
            return (
            <div key={cam.id} className="card p-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${cam.isActive ? 'bg-green-100' : 'bg-gray-100'}`}>
                    <VideoCameraIcon className={`w-5 h-5 ${cam.isActive ? 'text-green-600' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold">{cam.name}</h3>
                    <p className="text-sm text-gray-500">{cam.type}{cam.lineRatio ? ` · line ${cam.lineRatio}` : ''}</p>
                  </div>
                </div>
                {role === 'EXIT' && <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded">Exit camera</span>}
                {role === 'CCTV' && <span className="px-2 py-1 bg-gray-800 text-white text-xs font-medium rounded">Room CCTV · locked</span>}
                {role === 'BOTH' && <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">Exit + Room</span>}
              </div>
              <div className="bg-gray-900 rounded-lg aspect-video mb-4 relative overflow-hidden">
                {locked && !streaming.has(cam.id) ? (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                    <div className="text-center px-4">
                      <VideoCameraIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm font-medium text-gray-300">Locked for privacy</p>
                      <p className="text-xs text-gray-500">Visible only during an ACTIVE fire</p>
                    </div>
                  </div>
                ) : streaming.has(cam.id) ? (
                  <img src={`${getCvBase()}/cameras/${cam.id}/feed`} alt={`${cam.name} live feed`} className="w-full h-full object-cover"
                    onError={() => setStreaming((p) => { const n = new Set(p); n.delete(cam.id); return n })} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <VideoCameraIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Stream not active</p>
                    </div>
                  </div>
                )}
                {streaming.has(cam.id) && (
                  <div className="absolute top-2 left-2 px-2 py-1 bg-red-600 text-white text-xs font-medium rounded flex items-center gap-1">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" /> LIVE
                  </div>
                )}
              </div>
              <div className="text-sm text-gray-600 mb-4 space-y-1">
                <p><strong>Location:</strong> {cam.floor?.name || 'N/A'}</p>
                <p><strong>Detections:</strong> {cam._count?.detections || 0}</p>
                <p><strong>Status:</strong> {cam.isActive ? 'Enabled' : 'Disabled'}</p>
                {locked && <p className="text-xs text-gray-500">Room CCTV never streams here — use the Fire Emergency console during a fire.</p>}
              </div>
              <div className="flex gap-2">
                {locked ? (
                  <span className="flex-1 text-center text-xs text-gray-500 border rounded-lg py-2">Locked — opens during ACTIVE fire</span>
                ) : streaming.has(cam.id) ? (
                  <button onClick={() => stopStream(cam.id)} className="flex-1 btn-danger flex items-center justify-center gap-2 text-sm"><StopIcon className="w-4 h-4" /> Stop</button>
                ) : (
                  <button onClick={() => startStream(cam)} className="flex-1 btn-success flex items-center justify-center gap-2 text-sm"><PlayIcon className="w-4 h-4" /> Start</button>
                )}
                <button onClick={() => toggleActive(cam)} className="btn-secondary btn-sm">{cam.isActive ? 'Disable' : 'Enable'}</button>
                <button onClick={() => setPendingDelete(cam)} className="p-2 text-gray-400 hover:text-red-600" aria-label={`Delete ${cam.name}`}><TrashIcon className="w-5 h-5" /></button>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal title={`Delete ${pendingDelete.name}?`} message="The camera and its detection history will be removed."
          confirmLabel="Delete camera" danger onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6">
            <h2 className="text-xl font-bold">Add camera — {step}/3</h2>
            <p className="text-sm text-gray-500 mb-4">{step === 1 ? 'Source & type' : step === 2 ? 'Placement' : 'Camera role'}</p>
            {/* stepper */}
            <div className="flex gap-1.5 mb-5">
              {[1, 2, 3].map((s) => <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-blue-600' : 'bg-gray-200'}`} />)}
            </div>
            {formError && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{formError}</div>}

            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div key="s1" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
                  <div>
                    <label className="label">Camera name *</label>
                    <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main Entrance — Ground Floor" autoFocus />
                  </div>
                  <div>
                    <label className="label">Type</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['WEBCAM', 'USB', 'IP', 'PHONE'] as CameraType[]).map((t) => (
                        <button key={t} type="button" onClick={() => setForm({ ...form, type: t, sourceUrl: t === 'WEBCAM' ? '0' : t === 'USB' ? '1' : form.sourceUrl })}
                          className={`px-2 py-2 rounded-lg text-xs font-bold border ${form.type === t ? 'bg-gray-900 text-white border-gray-900' : 'hover:bg-gray-50'}`}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="label">Source *</label>
                    <input className="input font-mono" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder={SOURCE_HINTS[form.type].placeholder} />
                    <p className="text-xs text-gray-500 mt-1">{SOURCE_HINTS[form.type].hint}</p>
                  </div>
                  <div className={`p-3 rounded-lg border text-sm ${testState === 'ok' ? 'border-green-200 bg-green-50' : testState === 'fail' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">Source check</span>
                      <button onClick={testSource} disabled={testState === 'testing'} className="px-3 py-1.5 border rounded-lg text-xs bg-white hover:bg-gray-50 disabled:opacity-50">
                        {testState === 'testing' ? 'Testing…' : 'Test source'}
                      </button>
                    </div>
                    {testState === 'ok' && <p className="text-green-700 text-xs mt-1 flex items-center gap-1"><CheckCircleIcon className="w-4 h-4" /> {testMsg}</p>}
                    {testState === 'fail' && <p className="text-amber-700 text-xs mt-1">{testMsg}</p>}
                    {testState === 'idle' && <p className="text-gray-500 text-xs mt-1">Recommended before saving — catches wrong index/URL early.</p>}
                  </div>
                </motion.div>
              )}
              {step === 2 && (
                <motion.div key="s2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
                  <div>
                    <label className="label">Floor / room</label>
                    <select className="input" value={form.floorId} onChange={(e) => setForm({ ...form, floorId: e.target.value })}>
                      <option value="">No specific floor</option>
                      {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Room cameras become visible to responders <strong>only during an ACTIVE fire</strong> — never to occupants.</p>
                  </div>
                  <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
                    Tip: name cameras by room (e.g. "Room 205 — North") so responders can find stuck people fast during a fire.
                  </div>
                </motion.div>
              )}
              {step === 3 && (
                <motion.div key="s3" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-3">
                  <label className="label">Camera role *</label>
                  {([
                    { v: 'EXIT', t: 'Exit camera', d: 'Door/gate counting for drills & evacuation. Previewable anytime.' },
                    { v: 'CCTV', t: 'Room CCTV (locked)', d: 'Indoor coverage. Hidden until an ACTIVE fire — managers/responders only.' },
                    { v: 'BOTH', t: 'Exit + Room', d: 'Counts exits in drills and also opens as room coverage during fire.' },
                  ] as const).map((o) => (
                    <label key={o.v} className={`flex items-start gap-2 text-sm p-3 border rounded-lg cursor-pointer ${form.role === o.v ? 'border-gray-900 bg-gray-50' : ''}`}>
                      <input type="radio" checked={form.role === o.v} onChange={() => setForm({ ...form, role: o.v })} className="mt-1" />
                      <span><strong>{o.t}</strong><br /><span className="text-gray-500 text-xs">{o.d}</span></span>
                    </label>
                  ))}
                  {form.role !== 'CCTV' && (
                    <>
                      <div>
                        <label className="label">Crossing direction</label>
                        <select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                          <option value="both">Both directions</option>
                          <option value="down">Down (top → bottom)</option>
                          <option value="up">Up (bottom → top)</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Evacuation line position: {form.lineRatio.toFixed(2)}</label>
                        <input type="range" min={0.2} max={0.85} step={0.01} value={form.lineRatio}
                          onChange={(e) => setForm({ ...form, lineRatio: Number(e.target.value) })} className="w-full" />
                        <p className="text-xs text-gray-500">Saved with the camera and reused in drills, tests and live views.</p>
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex gap-3 mt-6">
              {step > 1
                ? <button onClick={() => setStep(step - 1)} className="px-4 py-2 border rounded-lg flex items-center gap-1"><ArrowLeftIcon className="w-4 h-4" /> Back</button>
                : <button onClick={() => setShowAdd(false)} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>}
              <div className="flex-1" />
              {step < 3
                ? <button onClick={() => { if (step === 1 && !canNext1) { setFormError('Name and source are required.'); return } setFormError(''); setStep(step + 1) }} className="px-5 py-2 bg-gray-900 text-white rounded-lg flex items-center gap-1">Next <ArrowRightIcon className="w-4 h-4" /></button>
                : <button onClick={addCamera} className="btn-primary px-6">Save camera</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
