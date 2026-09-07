import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import api, { getCvBase } from '../../utils/api'
import SnapshotImg from './SnapshotImg'

type Facing = 'environment' | 'user'
type Role = 'EXIT' | 'CCTV' | 'BOTH'

// Remote uploads (Render / WAN): one frame at a time, ~3fps. The old 10fps
// firehose queued dozens of overlapping POSTs over high-latency links until
// the browser stalled and the server went stale.
const UPLOAD_EVERY_MS = 350
const RESUME_KEY = 'fire-safety-publish-resume'

/**
 * Browser-as-camera publisher (testing).
 * Phone/laptop opens /camera/publish/:cameraId, grants rear-camera permission,
 * and pushes JPEG frames to the Python CV service. Viewers poll the
 * proxy-safe /snapshot endpoint (see SnapshotImg).
 */
export default function BrowserPublisher() {
  const { cameraId } = useParams()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const beatRef = useRef<number | null>(null)
  const busyRef = useRef(false)
  const wakeRef = useRef<any>(null)
  const publishingRef = useRef(false)

  const [facing, setFacing] = useState<Facing>('environment')
  const [role, setRole] = useState<Role>('BOTH')
  const [publishing, setPublishing] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [camName, setCamName] = useState('')
  const [stats, setStats] = useState({ sent: 0, failed: 0, lastMs: 0 as number | null, lastStatus: '' })
  const [hasResume, setHasResume] = useState(false)

  const id = (cameraId || '').trim()

  // Camera name lookup (mismatch-proofing: publishing to the wrong camera
  // while viewing another is the #1 support trap).
  useEffect(() => {
    if (!id) return
    api.get(`/cameras/${id}`).then(
      (r) => setCamName(r.data?.name || ''),
      () => setCamName('')
    )
    try {
      const raw = localStorage.getItem(RESUME_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved.cameraId === id) {
          if (saved.facing === 'user' || saved.facing === 'environment') setFacing(saved.facing)
          if (saved.role === 'EXIT' || saved.role === 'CCTV' || saved.role === 'BOTH') setRole(saved.role)
          setHasResume(true)
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      void stopAll(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Changing camera direction restarts only the local preview — the upload
  // timer keeps running (the old code killed it and silently stopped uploads).
  useEffect(() => {
    if (publishingRef.current) {
      void (async () => {
        await startPreview()
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing])

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const releaseWake = () => {
    try {
      wakeRef.current?.release?.()
    } catch {
      // ignore
    }
    wakeRef.current = null
  }

  const stopAll = async (notifyServer = true) => {
    publishingRef.current = false
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (beatRef.current) {
      window.clearInterval(beatRef.current)
      beatRef.current = null
    }
    releaseWake()
    if (notifyServer && id) {
      try {
        await fetch(`${getCvBase()}/cameras/${id}/stop`, { method: 'POST' })
      } catch {
        // ignore
      }
    }
    stopTracks()
    busyRef.current = false
  }

  const startPreview = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera API unavailable. Use HTTPS (or localhost) + Chrome on Android.')
      return false
    }
    stopTracks()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      // If the OS kills the track (screen lock, phone call), say so loudly
      // instead of uploading empty frames forever.
      stream.getVideoTracks().forEach((t) => {
        t.onended = () => {
          if (publishingRef.current) setError('Camera track ended (screen locked or camera taken by another app). Tap Stop, then publish again.')
        }
      })
      return true
    } catch (e: any) {
      const name = e?.name || 'Error'
      if (name === 'NotAllowedError') setError('Camera permission denied. Allow camera access and retry.')
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          streamRef.current = stream
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            await videoRef.current.play().catch(() => {})
          }
          return true
        } catch {
          setError('No camera found on this device.')
          return false
        }
      } else setError(`Could not open camera (${name}). Use HTTPS + Chrome.`)
      return false
    }
  }

  /** POST /start with retries — covers Render cold starts (~60s). */
  const startRemoteLoop = async (): Promise<boolean> => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(`${getCvBase()}/cameras/${id}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'browser',
            is_exit: role !== 'CCTV',
            line_ratio: 0.62,
            direction: 'both',
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.success) return true
        // Already active from a previous tap — take it over cleanly.
        if (res.ok && data.success === false) return true
      } catch {
        // Service asleep / network blip — wait and retry.
      }
      if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 5000))
    }
    return false
  }

  const pushFrame = async () => {
    // Sequential: never overlap uploads; skip the tick while one is in flight.
    if (busyRef.current || !publishingRef.current) return
    if (!id || !videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    if (video.readyState < 2 || video.videoWidth === 0) return
    busyRef.current = true
    const t0 = performance.now()
    try {
      const canvas = canvasRef.current
      const targetW = 640
      const scale = targetW / video.videoWidth
      canvas.width = targetW
      canvas.height = Math.round(video.videoHeight * scale) || 480
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.6))
      if (!blob || !publishingRef.current) return
      const res = await fetch(`${getCvBase()}/cameras/${id}/frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      })
      const ms = Math.round(performance.now() - t0)
      setStats((s) =>
        res.ok
          ? { sent: s.sent + 1, failed: 0, lastMs: ms, lastStatus: `${res.status} OK · ${ms}ms` }
          : { ...s, failed: s.failed + 1, lastMs: ms, lastStatus: `HTTP ${res.status}` }
      )
    } catch {
      setStats((s) => ({ ...s, failed: s.failed + 1, lastStatus: 'network error' }))
    } finally {
      busyRef.current = false
    }
  }

  /** Heartbeat: if the server loop died (restart/sleep/stop elsewhere), restart it. */
  const heartbeat = async () => {
    if (!publishingRef.current || !id) return
    try {
      const res = await fetch(`${getCvBase()}/cameras/${id}/stats`)
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.active === false) {
        await startRemoteLoop()
      }
    } catch {
      // Next beat retries.
    }
  }

  const startPublishing = async () => {
    setError('')
    setInfo('')
    if (!id) {
      setError('Missing camera id. Open this page via the Publish link from Camera management.')
      return
    }
    const ok = await startPreview()
    if (!ok) return
    setInfo('Starting server loop… (first start after sleep can take up to a minute)')
    const started = await startRemoteLoop()
    if (!started) {
      setError(`Could not start the CV loop at ${getCvBase()} after retries. Check the CV service logs, then retry.`)
      setInfo('')
      return
    }
    // Keep the screen on while publishing (auto-lock silently kills uploads).
    try {
      const nav = navigator as any
      if (nav.wakeLock?.request) wakeRef.current = await nav.wakeLock.request('screen')
    } catch {
      // Unsupported — user must keep screen on manually.
    }
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify({ cameraId: id, role, facing }))
    } catch {
      // ignore
    }
    publishingRef.current = true
    setPublishing(true)
    setHasResume(false)
    setStats({ sent: 0, failed: 0, lastMs: null, lastStatus: '' })
    timerRef.current = window.setInterval(pushFrame, UPLOAD_EVERY_MS)
    beatRef.current = window.setInterval(heartbeat, 10000)
    setInfo('Publishing. Keep this tab in the foreground with the screen on — the exit/CCTV view now updates from the server.')
  }

  const stopPublishing = async () => {
    await stopAll(true)
    setPublishing(false)
    setInfo('Stopped. Remote view freezes on the last frame until another source starts.')
  }

  const secureContextOk = typeof window !== 'undefined' ? window.isSecureContext : true

  return (
    <div className="max-w-2xl mx-auto space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold">Publish phone camera</h1>
        <p className="text-sm text-gray-500">
          {camName ? (
            <>
              Publishing as <strong className="text-gray-800">{camName}</strong>
            </>
          ) : (
            <>
              Camera <span className="font-mono">{id || '(missing id)'}</span>
            </>
          )}{' '}
          · Role <span className="font-semibold">{role}</span> (EXIT counting + CCTV room coverage when BOTH)
        </p>
        {camName && <p className="text-xs text-gray-400 font-mono">{id}</p>}
      </div>

      {!secureContextOk && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
          Not a secure context — Android Chrome blocks the camera on plain http://LAN-IP. Open the site over HTTPS.
        </div>
      )}

      {hidden && publishing && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
          Tab is in the background — uploads are paused by the browser. Bring this tab forward to resume.
        </div>
      )}

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {info && <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{info}</div>}

      {publishing && (
        <div className="p-2.5 bg-gray-50 border rounded-lg text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            Delivered: <strong>{stats.sent}</strong>
          </span>
          <span>
            Failed: <strong className={stats.failed > 5 ? 'text-red-600' : ''}>{stats.failed}</strong>
          </span>
          {stats.lastStatus && (
            <span>
              Last: <span className="font-mono">{stats.lastStatus}</span>
            </span>
          )}
          {stats.failed > 5 && <span className="text-red-600">Uploads failing — check CV service status/logs.</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-sm font-medium">Camera:</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFacing('environment')}
            className={`px-3 py-1.5 rounded-lg text-sm border ${facing === 'environment' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white'}`}
          >
            Rear
          </button>
          <button
            type="button"
            onClick={() => setFacing('user')}
            className={`px-3 py-1.5 rounded-lg text-sm border ${facing === 'user' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white'}`}
          >
            Front
          </button>
        </div>
        <label className="text-sm font-medium ml-2">Role:</label>
        <div className="flex gap-2">
          {(['EXIT', 'CCTV', 'BOTH'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              disabled={publishing}
              className={`px-3 py-1.5 rounded-lg text-sm border ${role === r ? 'bg-gray-900 text-white border-gray-900' : 'bg-white'} disabled:opacity-50`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl overflow-hidden aspect-video">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-2">
        {!publishing ? (
          <button onClick={startPublishing} className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-lg font-medium">
            {hasResume ? 'Resume publishing' : 'Allow camera & start publishing'}
          </button>
        ) : (
          <button onClick={stopPublishing} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-medium">
            Stop publishing
          </button>
        )}
      </div>

      {publishing && id && (
        <div>
          <p className="text-sm font-medium mb-1">Remote CV view (annotated, ~1/sec):</p>
          <SnapshotImg cameraId={id} active={publishing} alt="Remote CV view" className="w-full rounded-xl border" />
        </div>
      )}

      <p className="text-xs text-gray-500">
        Tip: mount the phone at the exit/room, tap Rear + BOTH, keep this tab in the foreground with the screen on.
        If you refresh, just tap Resume — one tap re-grants the camera (browser security requires it).
      </p>
    </div>
  )
}
