import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { QrCodeIcon, PhotoIcon, PencilSquareIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

function extractQrCode(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const m = t.match(/\/building\/([A-Za-z0-9_\-]+)/)
  if (m) return m[1]
  if (/^BUILDING_[A-Za-z0-9_\-]+$/i.test(t) || /^[A-Za-z0-9_\-]{4,}$/.test(t)) return t
  return t
}

type PermState = 'checking' | 'granted' | 'denied' | 'no-camera' | 'insecure'

export default function QrScanner({ onScanned, onClose }: { onScanned: (qrCode: string) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'camera' | 'upload' | 'manual'>('camera')
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const [perm, setPerm] = useState<PermState>('checking')
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [retryN, setRetryN] = useState(0)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const fileRef = useRef<Html5Qrcode | null>(null)
  const mountedRef = useRef(true)

  const stopScanner = useCallback(async () => {
    try { await scannerRef.current?.stop() } catch {}
    try { await (scannerRef.current?.clear() as unknown as Promise<void>) } catch {}
    scannerRef.current = null
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; stopScanner() }
  }, [stopScanner])

  // Step 1: preflight permission + enumerate (fixes false "no permission" reports).
  useEffect(() => {
    if (mode !== 'camera') return
    let cancelled = false
    const preflight = async () => {
      setPerm('checking'); setError('')
      // getUserMedia needs a secure context — http://<lan-ip> counts as insecure.
      if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        if (!cancelled) {
          setPerm('insecure')
          setError('Live scanning needs HTTPS or localhost. This network address blocks camera access — use Upload or Manual here, or open the app via localhost/HTTPS.')
        }
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) { setPerm('no-camera'); setError('This browser cannot access cameras. Use Upload or Manual instead.') }
        return
      }
      try {
        // Trigger the real browser prompt first so Html5Qrcode inherits the grant.
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        s.getTracks().forEach((t) => t.stop())
        const list = await Html5Qrcode.getCameras().catch(() => [])
        if (cancelled) return
        if (!list.length) {
          setPerm('no-camera')
          setError('No cameras found on this device. Use Upload or Manual instead.')
          return
        }
        setCameras(list)
        // Prefer a rear/environment camera when labels are available.
        const rear = list.find((c) => /back|rear|environment/i.test(c.label))
        setDeviceId((prev) => prev || (rear || list[0]).id)
        setPerm('granted')
      } catch (e: any) {
        if (cancelled) return
        const name = e?.name || ''
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setPerm('denied')
          setError('Camera blocked. Click the camera icon in the address bar → Allow, then Retry. Your browser permission may be set for a different site URL.')
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setPerm('no-camera')
          setError('No usable camera found. Use Upload or Manual instead.')
        } else {
          setPerm('denied')
          setError(`Camera unavailable (${name || 'unknown'}). Another app may be using it — close other camera apps and Retry, or use Upload / Manual.`)
        }
      }
    }
    preflight()
    return () => { cancelled = true }
  }, [mode, retryN])

  // Step 2: start scanning only after permission granted + device known.
  useEffect(() => {
    if (mode !== 'camera' || perm !== 'granted') return
    let cancelled = false
    const start = async () => {
      await stopScanner()
      try {
        const s = new Html5Qrcode('fg-qr-reader')
        scannerRef.current = s
        const target = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' as const }
        await s.start(
          target as any,
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (cancelled || !mountedRef.current) return
            const code = extractQrCode(decoded)
            if (code) { onScanned(code); stopScanner() }
          },
          () => {}
        )
      } catch (e: any) {
        // Exact deviceId often fails on desktops — retry with loose facingMode once.
        if (deviceId && !cancelled) {
          try {
            const s2 = new Html5Qrcode('fg-qr-reader')
            scannerRef.current = s2
            await s2.start(
              { facingMode: 'environment' },
              { fps: 10, qrbox: { width: 240, height: 240 } },
              (decoded) => {
                if (cancelled || !mountedRef.current) return
                const code = extractQrCode(decoded)
                if (code) { onScanned(code); stopScanner() }
              },
              () => {}
            )
            return
          } catch {}
        }
        if (!cancelled && mountedRef.current) {
          setError('Could not start the viewfinder. The camera may be busy in another tab/app — close it and Retry, or use Upload / Manual.')
        }
      }
    }
    start()
    return () => { cancelled = true; stopScanner() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, perm, deviceId])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setError('')
    try {
      if (!fileRef.current) fileRef.current = new Html5Qrcode('fg-qr-file')
      const decoded = await fileRef.current.scanFile(f, true)
      const code = extractQrCode(decoded)
      if (code) onScanned(code)
      else setError('No QR code found in that image.')
    } catch {
      setError('Could not read QR from image. Try a clearer photo or manual entry.')
    }
  }

  const submitManual = () => {
    const code = extractQrCode(manual)
    if (!code) {
      setError('Enter a valid QR code (e.g. BUILDING_...) or paste the full building link.')
      return
    }
    onScanned(code)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold flex items-center gap-2"><QrCodeIcon className="w-5 h-5" /> Scan building QR</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><XMarkIcon className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(['camera', 'upload', 'manual'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2 py-2 rounded-lg text-sm border capitalize ${mode === m ? 'bg-gray-900 text-white border-gray-900' : 'hover:bg-gray-50'}`}>
              {m}
            </button>
          ))}
        </div>
        {error && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        {mode === 'camera' && (
          <div>
            {cameras.length > 1 && perm === 'granted' && (
              <select className="input mb-2" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {cameras.map((c) => <option key={c.id} value={c.id}>{c.label || `Camera ${c.id.slice(0, 8)}`}</option>)}
              </select>
            )}
            <div id="fg-qr-reader" className="rounded-xl overflow-hidden bg-black min-h-[240px]" />
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-gray-500">
                {perm === 'checking' ? 'Requesting camera permission…' : perm === 'granted' ? 'Point at the QR at the entrance.' : 'Camera not active.'}
              </p>
              {(perm === 'denied' || error) && (
                <button onClick={() => setRetryN((n) => n + 1)} className="text-xs px-3 py-1.5 border rounded-lg flex items-center gap-1">
                  <ArrowPathIcon className="w-3.5 h-3.5" /> Retry camera
                </button>
              )}
            </div>
          </div>
        )}
        {mode === 'upload' && (
          <label className="block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:bg-gray-50">
            <PhotoIcon className="w-8 h-8 mx-auto text-gray-400 mb-2" />
            <span className="text-sm font-medium">Upload a photo of the QR</span>
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])} />
            <div id="fg-qr-file" className="hidden" />
          </label>
        )}
        {mode === 'manual' && (
          <div className="space-y-3">
            <label className="label flex items-center gap-1"><PencilSquareIcon className="w-4 h-4" /> QR code or building link</label>
            <input className="input" value={manual} onChange={(e) => setManual(e.target.value)}
              placeholder="BUILDING_... or https://.../building/BUILDING_..." />
            <button onClick={submitManual} className="btn-primary w-full">Continue</button>
          </div>
        )}
      </div>
    </div>
  )
}
