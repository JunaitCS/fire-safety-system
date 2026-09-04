import { useEffect, useState, useMemo, useRef, Fragment } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { Stage, Layer, Rect, Circle, Line, Text, Image as KonvaImage } from 'react-konva'
import api, { getApiBase } from '../../utils/api'
import EmergencyAlert from '../../components/EmergencyAlert'
import { useSocketStore } from '../../store/socketStore'
import { useAuthStore } from '../../store/authStore'
import {
  BuildingOfficeIcon,
  MapPinIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PhoneIcon,
  ChatBubbleLeftRightIcon,
  ShieldCheckIcon,
  ArrowRightOnRectangleIcon,
  BellAlertIcon,
} from '@heroicons/react/24/outline'

const PRESENCE_KEY = 'fireguard-presence'

// Manager canvas size — the occupant map uses the same design space so the
// uploaded photo and drawn routes line up exactly like in the designer.
const DESIGN_W = 1000
const DESIGN_H = 700

function useFloorImage(url: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) {
      setImage(null)
      return
    }
    const img = new window.Image()
    img.onload = () => setImage(img)
    img.onerror = () => setImage(null)
    img.src = url
  }, [url])
  return image
}

export default function BuildingInfo() {
  const { qrCode } = useParams()
  const [searchParams] = useSearchParams()
  const autoCheckin = searchParams.get('autocheckin') === '1'
  const [building, setBuilding] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [checkedIn, setCheckedIn] = useState(false)
  const [presenceId, setPresenceId] = useState<string | null>(null)
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [floorHint, setFloorHint] = useState('')
  const [selectedFloorId, setSelectedFloorId] = useState('')
  const [complaintType, setComplaintType] = useState('safety')
  const [complaintMsg, setComplaintMsg] = useState('')
  const [complaintSent, setComplaintSent] = useState(false)
  const [complaintError, setComplaintError] = useState('')
  const [checkInError, setCheckInError] = useState('')
  const [emergency, setEmergency] = useState<any>(null)
  const [occupantCount, setOccupantCount] = useState(0)
  const { socket, connect, joinBuilding } = useSocketStore()
  const { user, token } = useAuthStore()

  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    if (!qrCode) return
    api.get(`/buildings/qr/${qrCode}`)
      .then(async (r) => {
        setBuilding(r.data)
        if (r.data.floors?.length) setSelectedFloorId(r.data.floors[0].id)
        // Validate presence server-side — stale localStorage never counts.
        try {
          const raw = localStorage.getItem(PRESENCE_KEY)
          if (raw) {
            const p = JSON.parse(raw)
            if (p.buildingId === r.data.id && p.presenceId) {
              if (token) {
                const v = await api.get('/presence/status', { params: { presenceId: p.presenceId } }).catch(() => null)
                if (v?.data?.active) {
                  setCheckedIn(true)
                  setPresenceId(p.presenceId)
                } else {
                  localStorage.removeItem(PRESENCE_KEY)
                }
              } else {
                setCheckedIn(true)
                setPresenceId(p.presenceId)
              }
            }
          }
        } catch {}
        if (autoCheckin && user?.name) {
          setGuestName(user.name)
        }
      })
      .catch(() => setError('Building not found or private'))
      .finally(() => setLoading(false))
  }, [qrCode])

  useEffect(() => {
    if (!building?.id) return
    joinBuilding(building.id)
    api.get(`/presence/building/${building.id}/count`)
      .then((r) => setOccupantCount(r.data.count))
      .catch(() => {})
    // Only fetch active emergencies when authenticated; guests rely on live socket pushes
    if (token) {
      const fetchEm = () => {
        api.get('/emergency/active', { params: { buildingId: building.id } }).then((r) => {
          const list = r.data || []
          // Prefer real FIRE over drill for the banner
          const e = list.find((x: any) => (x.type || 'FIRE') === 'FIRE') || list[0] || null
          setEmergency(e)
        }).catch(() => {})
      }
      fetchEm()
      // Poll fallback so the banner starts/ends without a page refresh
      // even if the socket momentarily drops.
      const t = window.setInterval(fetchEm, 5000)
      return () => window.clearInterval(t)
    }
  }, [building?.id, joinBuilding, token])

  useEffect(() => {
    if (!socket || !building?.id) return
    const onEm = (data: any) => {
      // Global pushes cover every building — only react to this page's one.
      if (data?.buildingId && building?.id && data.buildingId !== building.id) return
      // Drills render via the global EmergencyAlert banner (amber drill tone);
      // this page's red banner + map guidance is for real fires only.
      const t = String(data?.type || '').toUpperCase()
      if (t === 'DRILL' || /drill/i.test(data?.title || data?.message || '')) return
      if (data.buildingId === building.id) {
        setEmergency(data)
        // Sound + push notification are handled by EmergencyAlert (global
        // siren), so an alert heard here also stops from any other page.
      }
    }
    const onRes = (data: any) => {
      const currentId = data.emergencyId
      setEmergency((prev: any) => {
        if (!prev) return prev
        const prevId = prev.id || prev.emergencyId
        return prevId === currentId ? null : prev
      })
    }
    socket.on('emergency-started', onEm)
    socket.on('building-emergency', onEm)
    socket.on('fire-started', onEm)
    socket.on('drill-alert', onEm)
    socket.on('emergency-resolved', onRes)
    socket.on('fire-resolved', onRes)
    return () => {
      socket.off('emergency-started', onEm)
      socket.off('building-emergency', onEm)
      socket.off('fire-started', onEm)
      socket.off('drill-alert', onEm)
      socket.off('emergency-resolved', onRes)
      socket.off('fire-resolved', onRes)
    }
  }, [socket, building?.id])

  const requestNotifPermission = () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }

  const checkIn = async () => {
    if (!building) return
    requestNotifPermission()
    setCheckInError('')
    if (!guestName.trim() && !user?.name) {
      setCheckInError('Please enter your name to check in.')
      return
    }
    try {
      const res = await api.post('/presence/check-in', {
        buildingId: building.id,
        guestName: guestName || user?.name || 'Guest',
        guestPhone: guestPhone || user?.phone || '',
        floorHint,
      })
      setPresenceId(res.data.id)
      setCheckedIn(true)
      localStorage.setItem(PRESENCE_KEY, JSON.stringify({
        presenceId: res.data.id,
        buildingId: building.id,
        buildingName: building.name,
        qrCode: building.qrCode,
      }))
      setOccupantCount((c) => c + 1)
    } catch {
      setCheckInError('Check-in failed. Please try again.')
    }
  }

  const checkOut = async () => {
    if (!presenceId) return
    try {
      await api.post('/presence/check-out', { presenceId })
      setCheckedIn(false)
      setPresenceId(null)
      localStorage.removeItem(PRESENCE_KEY)
      setOccupantCount((c) => Math.max(0, c - 1))
    } catch {
      setCheckedIn(false)
      localStorage.removeItem(PRESENCE_KEY)
    }
  }

  const sendComplaint = async () => {
    if (!complaintMsg.trim() || !building) return
    setComplaintError('')
    if (!token) {
      setComplaintError('Please log in to submit a report so management can follow up.')
      return
    }
    try {
      await api.post('/complaints', {
        buildingId: building.id,
        type: complaintType,
        message: complaintMsg,
      })
      setComplaintSent(true)
      setComplaintMsg('')
    } catch {
      setComplaintError('Could not send report. Please try again.')
    }
  }

  const selectedFloor = useMemo(
    () => building?.floors?.find((f: any) => f.id === selectedFloorId),
    [building, selectedFloorId]
  )

  const elements = useMemo(() => {
    return (selectedFloor?.elements || []).map((el: any) => {
      let label = ''
      let points: number[] | undefined
      if (el.properties) {
        try {
          const p = JSON.parse(el.properties)
          label = p.label || ''
          points = p.points || undefined
        } catch {}
      }
      return { ...el, label, points }
    })
  }, [selectedFloor])

  // Merged map: uploaded photo behind, drawn routes on top — same design
  // space as the manager canvas. Scales down to fit phones.
  const mapWrapRef = useRef<HTMLDivElement>(null)
  const [mapScale, setMapScale] = useState(0.7)
  const floorImageUrl = selectedFloor?.imageUrl ? `${getApiBase()}${selectedFloor.imageUrl}` : null
  const floorImage = useFloorImage(floorImageUrl)

  useEffect(() => {
    const update = () => {
      const w = mapWrapRef.current?.clientWidth
      if (w && w > 0) setMapScale(Math.min(1, w / DESIGN_W))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [building?.id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !building) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="card text-center max-w-md">
          <BuildingOfficeIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Building Not Found</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Global siren + alert banner, scoped to this building: fire wail for
          real alerts, drill tone for practice, with vibration on phones. */}
      {building && <EmergencyAlert filterBuildingId={building.id} />}
      {/* Emergency banner */}
      {emergency && (
        <div className="bg-red-600 text-white p-4 emergency-alert">
          <div className="max-w-4xl mx-auto flex items-start gap-3">
            <BellAlertIcon className="w-8 h-8 animate-bounce flex-shrink-0" />
            <div>
              <h2 className="text-xl font-bold">FIRE EMERGENCY — EVACUATE NOW</h2>
              <p className="text-red-100">{emergency.message}</p>
              <p className="text-sm text-red-200 mt-1">Use stairs only · Follow green EXIT marks on the map below</p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto p-4 space-y-4">
        {/* Building header */}
        <div className="card">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <ShieldCheckIcon className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">FireGuard Building Protocol</p>
              <h1 className="text-2xl font-bold text-gray-900">{building.name}</h1>
              <p className="text-gray-600 flex items-center gap-1 mt-1">
                <MapPinIcon className="w-4 h-4" /> {building.address}
              </p>
              {building.description && (
                <p className="text-sm text-gray-500 mt-2">{building.description}</p>
              )}
              <p className="text-xs text-gray-400 mt-2">{occupantCount} people currently checked in</p>
            </div>
          </div>
        </div>

        {/* Check-in */}
        <div className={`card ${checkedIn ? 'border-green-300 bg-green-50/50' : 'border-blue-200'}`}>
          {checkedIn ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CheckCircleIcon className="w-8 h-8 text-green-600" />
                <div>
                  <p className="font-semibold text-green-900">You are checked in</p>
                  <p className="text-sm text-green-700">You will receive fire alerts for this building</p>
                </div>
              </div>
              <button onClick={checkOut} className="px-4 py-2 border border-green-300 rounded-lg text-sm text-green-800 hover:bg-white flex items-center gap-1">
                <ArrowRightOnRectangleIcon className="w-4 h-4" /> Check out
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="font-semibold text-gray-900">Enter building safety protocol</h2>
              <p className="text-sm text-gray-600">
                Check in so you receive emergency alerts, evacuation maps, and can send SOS if needed.
              </p>
              {checkInError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{checkInError}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input className="input" placeholder="Your name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
                <input className="input" placeholder="Phone (optional)" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
                <input className="input" placeholder="Floor / room (optional)" value={floorHint} onChange={(e) => setFloorHint(e.target.value)} />
              </div>
              <button onClick={checkIn} className="btn-primary w-full sm:w-auto">
                Check in to {building.name}
              </button>
            </div>
          )}
        </div>

        {/* Evacuation map */}
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="font-semibold">Evacuation map</h2>
            <select
              className="input w-40 text-sm"
              value={selectedFloorId}
              onChange={(e) => setSelectedFloorId(e.target.value)}
            >
              {(building.floors || []).map((f: any) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          {(building.floors || []).length === 0 ? (
            <p className="text-sm text-gray-500">No floor plans published yet.</p>
          ) : (
            <div ref={mapWrapRef} className="border rounded-lg overflow-auto bg-slate-50">
              <Stage width={DESIGN_W * mapScale} height={DESIGN_H * mapScale}>
                <Layer scaleX={mapScale} scaleY={mapScale}>
                  {floorImage ? (
                    <KonvaImage image={floorImage} x={0} y={0} width={DESIGN_W} height={DESIGN_H} listening={false} />
                  ) : (
                    <>
                      {Array.from({ length: Math.ceil(DESIGN_W / 25) }).map((_, i) => (
                        <Line key={`v${i}`} points={[i * 25, 0, i * 25, DESIGN_H]} stroke="#e2e8f0" strokeWidth={0.5} />
                      ))}
                      {Array.from({ length: Math.ceil(DESIGN_H / 25) }).map((_, i) => (
                        <Line key={`h${i}`} points={[0, i * 25, DESIGN_W, i * 25]} stroke="#e2e8f0" strokeWidth={0.5} />
                      ))}
                    </>
                  )}
                  {elements.map((el: any) => {
                    if (el.type === 'PATH' && el.points?.length >= 4) {
                      return (
                        <Line key={el.id} points={el.points} stroke="#f59e0b" strokeWidth={4} dash={[10, 6]} />
                      )
                    }
                    if (el.type === 'CAMERA') {
                      return <Circle key={el.id} x={el.x + 14} y={el.y + 14} radius={10} fill="#3b82f6" />
                    }
                    if (el.type === 'FIRE_EXTINGUISHER') {
                      return <Circle key={el.id} x={el.x + 12} y={el.y + 12} radius={9} fill="#dc2626" />
                    }
                    const fill =
                      el.type === 'WALL' ? '#1f2937' :
                      el.type === 'DOOR' ? '#d97706' :
                      el.type === 'ROOM' ? 'rgba(59,130,246,0.15)' :
                      el.type === 'EMERGENCY_EXIT' ? '#059669' :
                      el.type === 'ASSEMBLY' ? 'rgba(13,148,136,0.3)' :
                      el.type === 'STAIRS' ? '#6366f1' : '#94a3b8'
                    return (
                      <Fragment key={el.id}>
                        <Rect
                          x={el.x}
                          y={el.y}
                          width={el.width}
                          height={el.height}
                          fill={fill}
                          cornerRadius={el.type === 'EMERGENCY_EXIT' ? 4 : 0}
                        />
                        {el.label && (
                          <Text
                            x={el.x}
                            y={el.y + el.height / 2 - 6}
                            width={Math.max(el.width, 60)}
                            text={el.label}
                            fontSize={10}
                            fontStyle="bold"
                            fill={el.type === 'EMERGENCY_EXIT' ? '#fff' : '#0f172a'}
                            align="center"
                          />
                        )}
                      </Fragment>
                    )
                  })}
                </Layer>
              </Stage>
              {selectedFloor?.imageUrl && !floorImage && (
                <p className="text-xs text-gray-400 p-2">Loading floor plan image…</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-600">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-600 rounded" /> Exit</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-500 rounded" /> Evac route</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-500 rounded" /> Stairs</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-600 rounded-full" /> Extinguisher</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-teal-600/40 rounded" /> Assembly</span>
          </div>
        </div>

        {/* Safety instructions */}
        <div className="card bg-orange-50 border-orange-200">
          <h2 className="font-semibold text-orange-900 mb-2 flex items-center gap-2">
            <ExclamationTriangleIcon className="w-5 h-5" /> If the alarm sounds
          </h2>
          <ol className="list-decimal list-inside text-sm text-orange-900 space-y-1">
            <li>Stay calm — walk, do not run</li>
            <li>Leave belongings that slow you down</li>
            <li>Use stairs only — never elevators</li>
            <li>Follow EXIT marks and amber evacuation paths on the map</li>
            <li>Go to the assembly point and wait for clearance</li>
            <li>If trapped, use SOS and call local emergency services</li>
          </ol>
        </div>

        {/* SOS + Complaint */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <h2 className="font-semibold mb-2 flex items-center gap-2">
              <PhoneIcon className="w-5 h-5 text-red-600" /> Need help?
            </h2>
            <p className="text-sm text-gray-600 mb-3">
              During an emergency, open the SOS page to alert responders with your location.
            </p>
            <Link to="/occupant/emergency" className="btn-danger inline-flex items-center gap-2">
              Open SOS / Emergency
            </Link>
            {!user && (
              <p className="text-xs text-gray-500 mt-2">
                <Link to="/login" className="text-blue-600 underline">Log in</Link> for full SOS with your profile.
              </p>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold mb-2 flex items-center gap-2">
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-blue-600" /> Report an issue
            </h2>
            {complaintSent ? (
              <p className="text-sm text-green-700">Thanks — your report was sent to building management.</p>
            ) : (
              <div className="space-y-2">
                {complaintError && (
                  <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">{complaintError}</div>
                )}
                <select className="input text-sm" value={complaintType} onChange={(e) => setComplaintType(e.target.value)}>
                  <option value="safety">Safety hazard</option>
                  <option value="maintenance">Blocked exit / maintenance</option>
                  <option value="equipment">Fire equipment</option>
                  <option value="suggestion">Suggestion</option>
                </select>
                <textarea
                  className="input h-20 text-sm resize-none"
                  placeholder="Describe what needs fixing…"
                  value={complaintMsg}
                  onChange={(e) => setComplaintMsg(e.target.value)}
                />
                <button onClick={sendComplaint} className="btn-primary text-sm w-full">Submit report</button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 pb-8">
          Powered by FireGuard Pro · Building QR: {building.qrCode}
        </p>
      </div>
    </div>
  )
}
