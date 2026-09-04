import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../../utils/api'
import { useAuthStore } from '../../store/authStore'
import QrScanner from '../../components/occupant/QrScanner'
import { PhoneIcon, QrCodeIcon, ShieldCheckIcon, BuildingOfficeIcon, MapPinIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'

const PRESENCE_KEY = 'fireguard-presence'

interface CheckedIn {
  id: string
  buildingId: string
  building: { id: string; name: string; address: string; qrCode: string }
  checkedInAt: string
}

export default function OccupantDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [checked, setChecked] = useState<CheckedIn[]>([])
  const [loading, setLoading] = useState(true)
  const [showScanner, setShowScanner] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Single source of truth: server-side ACTIVE presences only.
      const r = await api.get('/presence/mine')
      const list: CheckedIn[] = r.data || []
      setChecked(list)
      // Drop stale localStorage if server says not checked in anywhere
      if (!list.length) {
        try { localStorage.removeItem(PRESENCE_KEY) } catch {}
      } else {
        try {
          const first = list[0]
          localStorage.setItem(PRESENCE_KEY, JSON.stringify({
            presenceId: first.id, buildingId: first.buildingId,
            buildingName: first.building?.name, qrCode: first.building?.qrCode,
          }))
        } catch {}
      }
    } catch {
      // Fallback: validate localStorage entry so stale check-ins never show buildings
      try {
        const raw = localStorage.getItem(PRESENCE_KEY)
        if (raw) {
          const p = JSON.parse(raw)
          if (p?.presenceId) {
            const v = await api.get('/presence/status', { params: { presenceId: p.presenceId } })
            if (!v.data?.active) {
              localStorage.removeItem(PRESENCE_KEY)
              setChecked([])
            }
          } else setChecked([])
        }
      } catch { setChecked([]) }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const checkOut = async (presenceId: string) => {
    try {
      await api.post('/presence/check-out', { presenceId })
      load()
    } catch {}
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {user?.name}</h1>
          <p className="text-gray-600">Your personal fire safety hub — only buildings you're checked into appear here.</p>
        </div>
        <button onClick={() => setShowScanner(true)} className="btn-primary flex items-center gap-2 whitespace-nowrap">
          <QrCodeIcon className="w-5 h-5" /> Scan QR
        </button>
      </div>

      {loading ? (
        <div className="card py-10 flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Checking your check-ins…</p>
        </div>
      ) : checked.length > 0 ? (
        <div className="space-y-3">
          {checked.map((c) => (
            <div key={c.id} className="card border-green-300 bg-green-50/60">
              <div className="flex items-start gap-3">
                <BuildingOfficeIcon className="w-8 h-8 text-green-700 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-green-700 font-medium">Currently checked in</p>
                  <h2 className="text-lg font-bold text-green-900">{c.building?.name}</h2>
                  <p className="text-xs text-green-800">{c.building?.address}</p>
                  <p className="text-sm text-green-800 mt-1">You will receive fire + drill alerts for this building.</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Link to={`/building/${c.building?.qrCode}`} className="text-sm font-medium text-green-800 underline">
                      Open protocol & evacuation map
                    </Link>
                    <button onClick={() => checkOut(c.id)} className="text-sm text-gray-500 underline flex items-center gap-1">
                      <ArrowRightOnRectangleIcon className="w-4 h-4" /> Check out
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card border-dashed border-2 border-gray-300 text-center py-8">
          <QrCodeIcon className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <h2 className="font-semibold">Not checked into any building</h2>
          <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">
            Scan the QR code at the entrance to join that building's fire safety protocol. Unchecked buildings are never listed here.
          </p>
          <button onClick={() => setShowScanner(true)} className="btn-primary mt-4">Scan QR to check in</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link to="/occupant/emergency" className="card hover:shadow-md transition-shadow flex items-center gap-4">
          <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
            <PhoneIcon className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold">Emergency & SOS</h3>
            <p className="text-sm text-gray-500">Active alerts for your buildings</p>
          </div>
        </Link>
        {checked[0] && (
          <Link to={`/building/${checked[0].building?.qrCode}`} className="card hover:shadow-md transition-shadow flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <MapPinIcon className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold">Evacuation map</h3>
              <p className="text-sm text-gray-500">Routes, exits, assembly points</p>
            </div>
          </Link>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <ShieldCheckIcon className="w-5 h-5 text-green-600" /> How this works
        </h2>
        <ol className="space-y-2 text-sm text-gray-700 list-decimal list-inside">
          <li>Tap Scan QR and point at the door code (or upload / paste it)</li>
          <li>Check in with your name (and floor if you know it)</li>
          <li>Only that building appears here until you check out</li>
          <li>If fire or drill is declared, checked-in occupants are alerted instantly</li>
          <li>Follow the on-screen evacuation map · use SOS if trapped</li>
        </ol>
      </div>

      {showScanner && (
        <QrScanner
          onClose={() => setShowScanner(false)}
          onScanned={(qr) => { setShowScanner(false); navigate(`/building/${qr}?autocheckin=1`) }}
        />
      )}
    </div>
  )
}
