import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getCvBase } from '../../utils/api'

type Facing = 'environment' | 'user'

/**
 * Browser-as-camera publisher (testing).
 * Phone/laptop opens /camera/publish/:cameraId, grants rear-camera permission,
 * and pushes JPEG frames to the Python CV service. The existing MJPEG
 * /cameras/:id/feed downlink + YOLO counting then work unchanged.
 */
export default function BrowserPublisher() {
  const { cameraId } = useParams()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)

  const [facing, setFacing] = useState<Facing>('environment')
  const [role, setRole] = useState<'EXIT' | 'CCTV' | 'BOTH'>('BOTH')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [remoteOn, setRemoteOn] = useState(false)

  const id = (cameraId || '').trim()

  useEffect(() => {
    return () => stopAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restart local preview when facing changes while publishing.
  useEffect(() => {
    if (publishing) {
      void (async () => {
        await startPreview()
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing])

  const stopAll = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const startPreview = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera API unavailable. Use HTTPS (or localhost) + Chrome on Android.')
      return false
    }
    stopAll()
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
      return true
    } catch (e: any) {
      const name = e?.name || 'Error'
      if (name === 'NotAllowedError') setError('Camera permission denied. Allow camera access and retry.')
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        // Fallback: try without facingMode (some laptops/iOS).
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

  const pushFrame = async () => {
    if (!id || !videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    if (video.readyState < 2 || video.videoWidth === 0) return
    const canvas = canvasRef.current
    const targetW = 640
    const scale = targetW / video.videoWidth
    canvas.width = targetW
    canvas.height = Math.round(video.videoHeight * scale) || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.7))
    if (!blob) return
    try {
      await fetch(`${getCvBase()}/cameras/${id}/frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      })
    } catch {
      // Transient network loss — next tick retries. Phone can reconnect freely.
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
    try {
      await fetch(`${getCvBase()}/cameras/${id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'browser',
          is_exit: role !== 'CCTV',
          line_ratio: 0.62,
          direction: 'both',
        }),
      })
    } catch {
      setError(`Could not reach CV service at ${getCvBase()}. Keep this tab open and check WiFi/VITE_CV_URL.`)
      return
    }
    timerRef.current = window.setInterval(pushFrame, 100) // ~10fps, 640px JPEG
    setPublishing(true)
    setRemoteOn(true)
    setInfo('Publishing rear camera. Keep this tab open — the exit/CCTV feed now shows annotated YOLO output.')
  }

  const stopPublishing = async () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    try {
      if (id) await fetch(`${getCvBase()}/cameras/${id}/stop`, { method: 'POST' })
    } catch {
      // ignore
    }
    stopAll()
    setPublishing(false)
    setRemoteOn(false)
    setInfo('Stopped. Remote feed shows the last frame until another source starts.')
  }

  const secureContextOk = typeof window !== 'undefined' ? window.isSecureContext : true

  return (
    <div className="max-w-2xl mx-auto space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold">Publish phone camera</h1>
        <p className="text-sm text-gray-500">
          Camera <span className="font-mono">{id || '(missing id)'}</span> · Role{' '}
          <span className="font-semibold">{role}</span> (EXIT counting + CCTV room coverage when BOTH)
        </p>
      </div>

      {!secureContextOk && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
          Not a secure context — Android Chrome blocks camera on plain http://LAN-IP. Serve frontend over HTTPS
          (vite --host --https) or test on localhost.
        </div>
      )}

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {info && <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{info}</div>}

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
            Allow camera & start publishing
          </button>
        ) : (
          <button onClick={stopPublishing} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-medium">
            Stop publishing
          </button>
        )}
      </div>

      {remoteOn && id && (
        <div>
          <p className="text-sm font-medium mb-1">Remote CV feed (annotated):</p>
          <img src={`${getCvBase()}/cameras/${id}/feed`} alt="Remote CV feed" className="w-full rounded-xl border" />
        </div>
      )}

      <p className="text-xs text-gray-500">
        Tip: mount the phone at the exit/room, tap Rear + BOTH, keep the screen on. Stop from here or from Camera
        management. No app install needed.
      </p>
    </div>
  )
}
