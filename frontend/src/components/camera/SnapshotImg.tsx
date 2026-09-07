import { useEffect, useRef, useState } from 'react'
import { getCvBase } from '../../utils/api'

interface Props {
  cameraId: string
  /** Poll only while true. Flipping to false stops network traffic. */
  active: boolean
  intervalMs?: number
  alt?: string
  className?: string
  /** Override the CV host (e.g. feedUrl base from the gated feeds endpoint). */
  baseUrl?: string
  onState?: (s: 'live' | 'waiting' | 'stale' | 'error') => void
}

/**
 * Proxy-safe live view: polls GET /cameras/:id/snapshot (single short-lived
 * JPEG) instead of holding the infinite MJPEG /feed stream open — which can
 * monopolize a sync gunicorn worker until it is killed (wiping all camera
 * state). Visually equivalent at ~1fps for monitoring purposes.
 */
export default function SnapshotImg({ cameraId, active, intervalMs = 800, alt = 'Live view', className, baseUrl, onState }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(true)
  const timerRef = useRef<number | null>(null)
  const urlRef = useRef<string | null>(null)
  const failRef = useRef(0)
  const onStateRef = useRef(onState)
  onStateRef.current = onState

  useEffect(() => {
    if (!active || !cameraId) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    let cancelled = false
    const base = (baseUrl || getCvBase()).replace(/\/$/, '')

    const tick = async () => {
      try {
        const res = await fetch(`${base}/cameras/${cameraId}/snapshot`)
        if (cancelled) return
        if (res.status === 204) {
          // Loop running but no frame pushed yet (phone not publishing).
          setWaiting(true)
          failRef.current = 0
          onStateRef.current?.('waiting')
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        if (cancelled || blob.size === 0) return
        const next = URL.createObjectURL(blob)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = next
        setUrl(next)
        setWaiting(false)
        failRef.current = 0
        onStateRef.current?.('live')
      } catch {
        if (cancelled) return
        failRef.current += 1
        // Only report error after consecutive failures (cold starts / sleep).
        if (failRef.current >= 3) onStateRef.current?.('error')
      }
    }

    void tick()
    timerRef.current = window.setInterval(tick, intervalMs)

    return () => {
      cancelled = true
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [active, cameraId, intervalMs, baseUrl])

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  if (!url) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
        {waiting ? 'Waiting for camera…' : 'Connecting…'}
      </div>
    )
  }

  return <img src={url} alt={alt} className={className} draggable={false} />
}
