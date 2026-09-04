import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api, { getCvBase } from '../../utils/api'
import {
  ArrowLeftIcon,
  PlayIcon,
  StopIcon,
  VideoCameraIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

interface Camera {
  id: string
  name: string
  type: string
  sourceUrl: string
  isExit: boolean
  role?: string
  lineRatio?: number | null
  direction?: string | null
  isActive: boolean
  floor?: { name: string }
}

export default function CameraTest() {
  const { buildingId } = useParams()
  const [buildings, setBuildings] = useState<any[]>([])
  const [selectedBuilding, setSelectedBuilding] = useState(buildingId || '')
  const [cameras, setCameras] = useState<Camera[]>([])
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [personCount, setPersonCount] = useState<number | null>(null)
  const [trackCount, setTrackCount] = useState<number | null>(null)
  const [exitedCount, setExitedCount] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'starting' | 'live' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [cvHealthy, setCvHealthy] = useState<boolean | null>(null)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    api.get('/buildings').then((r) => {
      setBuildings(r.data)
      if (!selectedBuilding && r.data.length) setSelectedBuilding(r.data[0].id)
    })
    checkCv()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedBuilding) {
      api.get(`/cameras/building/${selectedBuilding}`).then((r) => {
        // Test bench covers the EXIT fleet (drill cameras). Room CCTV stays
        // locked and is verified inside the Fire Emergency console instead.
        const list: Camera[] = (r.data || []).filter((c: Camera) => c.isExit || (c.role && c.role !== 'CCTV'))
        setCameras(list)
        setSelectedCamera(list[0] || null)
      })
    }
  }, [selectedBuilding])

  useEffect(() => {
    return () => { stopAll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checkCv = async () => {
    try {
      const r = await fetch(`${getCvBase()}/health`)
      setCvHealthy(r.ok)
    } catch {
      setCvHealthy(false)
    }
  }

  const stopAll = async () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (selectedCamera && streaming) {
      try {
        await fetch(`${getCvBase()}/cameras/${selectedCamera.id}/stop`, { method: 'POST' })
      } catch { /* ignore */ }
    }
    setStreaming(false)
    setStatus('idle')
    setPersonCount(null)
  }

  /** Start detection using the camera's SAVED configuration from building settings. */
  const startDetection = async () => {
    if (!selectedCamera) {
      setErrorMsg('Select a camera first')
      return
    }
    await stopAll()
    setStatus('starting')
    setErrorMsg('')

    try {
      const res = await fetch(`${getCvBase()}/cameras/${selectedCamera.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: selectedCamera.sourceUrl,
          is_exit: selectedCamera.isExit,
          line_ratio: selectedCamera.lineRatio ?? 0.62,
          direction: selectedCamera.direction || 'both',
        }),
      })
      if (!res.ok) throw new Error('Could not start the saved camera configuration')
      setStreaming(true)
      setStatus('live')

      pollRef.current = window.setInterval(async () => {
        try {
          const s = await fetch(`${getCvBase()}/cameras/${selectedCamera.id}/stats`)
          const data = await s.json()
          setPersonCount(data.count ?? 0)
          setTrackCount(data.tracks ?? data.count ?? 0)
          setExitedCount(data.exited ?? 0)
        } catch {
          /* ignore */
        }
      }, 1500)
    } catch (e: any) {
      setStatus('error')
      setErrorMsg(e?.message || 'Could not start detection. Is the detection service running?')
      setCvHealthy(false)
    }
  }

  const roleLabel = selectedCamera ? (selectedCamera.role || (selectedCamera.isExit ? 'EXIT' : 'CCTV')) : ''

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/manager/buildings" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeftIcon className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Exit camera test</h1>
          <p className="text-gray-600">Verifies the saved exit-camera setup before a drill</p>
        </div>
      </div>

      <div className={`card flex items-center gap-3 ${cvHealthy === false ? 'border-red-300 bg-red-50' : cvHealthy ? 'border-green-300 bg-green-50' : ''}`}>
        {cvHealthy === null ? (
          <p className="text-sm text-gray-600">Checking detection service…</p>
        ) : cvHealthy ? (
          <>
            <CheckCircleIcon className="w-6 h-6 text-green-600" />
            <div>
              <p className="font-medium text-green-800">Detection service online</p>
              <p className="text-sm text-green-700">Person detection is available</p>
            </div>
          </>
        ) : (
          <>
            <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
            <div>
              <p className="font-medium text-red-800">Detection service offline</p>
              <p className="text-sm text-red-700">Start the Python detection service, then retry.</p>
            </div>
            <button onClick={checkCv} className="ml-auto text-sm underline text-red-700">Retry</button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <div className="card space-y-3">
            <label className="label">Building</label>
            <select className="input" value={selectedBuilding} onChange={(e) => setSelectedBuilding(e.target.value)}>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            <label className="label">Exit camera</label>
            <select
              className="input"
              value={selectedCamera?.id || ''}
              onChange={(e) => {
                const c = cameras.find((x) => x.id === e.target.value) || null
                setSelectedCamera(c)
              }}
            >
              {cameras.length === 0 && <option value="">No exit cameras — add one in Cameras</option>}
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {selectedCamera && (
              <div className="p-3 bg-gray-50 border rounded-lg text-sm space-y-1">
                <p className="font-medium">{selectedCamera.name}</p>
                <p className="text-gray-600">{selectedCamera.floor?.name || 'Location not set'} · {selectedCamera.type} · {roleLabel === 'BOTH' ? 'Exit + Room' : 'Exit camera'}</p>
                <p className="text-xs text-gray-500">Uses this camera's saved settings (position, direction, counting line) — no manual setup needed here.</p>
              </div>
            )}
          </div>

          <div className="card space-y-2">
            <button onClick={startDetection} disabled={status === 'starting' || !selectedCamera}
              className="w-full btn-success flex items-center justify-center gap-2">
              <PlayIcon className="w-5 h-5" /> Start test feed
            </button>
            <button onClick={stopAll} disabled={status === 'idle'}
              className="w-full btn-danger flex items-center justify-center gap-2">
              <StopIcon className="w-5 h-5" /> Stop
            </button>
            <p className="text-xs text-gray-500">Room CCTV is tested from the Fire Emergency console during a drill-fire, not here.</p>
          </div>

          {personCount !== null && (
            <div className="grid grid-cols-3 gap-2">
              <div className="card text-center p-3">
                <p className="text-xs text-gray-500">People now</p>
                <p className="text-3xl font-bold text-blue-600">{personCount}</p>
              </div>
              <div className="card text-center p-3">
                <p className="text-xs text-gray-500">Active tracks</p>
                <p className="text-3xl font-bold text-emerald-600">{trackCount ?? 0}</p>
              </div>
              <div className="card text-center p-3">
                <p className="text-xs text-gray-500">Exited</p>
                <p className="text-3xl font-bold text-orange-600">{exitedCount ?? 0}</p>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Live preview</h2>
            {status === 'live' && (
              <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded">
                <span className="w-2 h-2 bg-red-600 rounded-full animate-pulse" /> LIVE
              </span>
            )}
          </div>

          <div className="bg-gray-900 rounded-xl aspect-video flex items-center justify-center overflow-hidden relative">
            {streaming && selectedCamera && (
              <img
                src={`${getCvBase()}/cameras/${selectedCamera.id}/feed`}
                alt={`${selectedCamera.name} test feed`}
                className="w-full h-full object-contain"
              />
            )}
            {status === 'idle' && (
              <div className="text-center text-gray-500 p-6">
                <VideoCameraIcon className="w-16 h-16 mx-auto mb-3 opacity-40" />
                <p>Select an exit camera and start the test</p>
              </div>
            )}
            {status === 'starting' && <div className="text-white text-sm">Starting camera…</div>}
            {status === 'error' && (
              <div className="text-center text-red-300 p-6 max-w-md">
                <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-2" />
                <p>{errorMsg}</p>
              </div>
            )}
          </div>

          <div className="mt-4 text-sm text-gray-600">
            <p>Walk across the counting line in the video — each crossing is counted once as exited.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
