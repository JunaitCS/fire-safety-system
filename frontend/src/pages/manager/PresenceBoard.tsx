import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../utils/api'
import { useSocketStore } from '../../store/socketStore'
import { PageHeader, LoadingState, EmptyState } from '../../components/ui'
import { UsersIcon } from '@heroicons/react/24/outline'

interface Presence {
  id: string
  buildingId: string
  guestName?: string | null
  guestPhone?: string | null
  floorHint?: string | null
  checkedInAt: string
  user?: { id: string; name: string; phone?: string; email: string } | null
}

export default function PresenceBoard() {
  const { buildingId } = useParams()
  const [buildings, setBuildings] = useState<any[]>([])
  const [selected, setSelected] = useState(buildingId || '')
  const [list, setList] = useState<Presence[]>([])
  const [sos, setSos] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { socket, joinBuilding } = useSocketStore()

  useEffect(() => {
    api.get('/buildings').then((r) => {
      setBuildings(r.data)
      if (!selected && r.data.length) setSelected(buildingId || r.data[0].id)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selected) return
    fetchAll()
    joinBuilding(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  useEffect(() => {
    if (!socket) return
    const reload = () => { if (selected) fetchAll() }
    socket.on('occupant-checked-in', reload)
    socket.on('occupant-checked-out', reload)
    socket.on('sos-received', reload)
    socket.on('sos-updated', reload)
    return () => {
      socket.off('occupant-checked-in', reload)
      socket.off('occupant-checked-out', reload)
      socket.off('sos-received', reload)
      socket.off('sos-updated', reload)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, selected])

  const fetchAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [p, s] = await Promise.all([
        api.get(`/presence/building/${selected}`),
        api.get(`/sos/building/${selected}`).catch(() => ({ data: [] })),
      ])
      setList(p.data)
      setSos(s.data.filter((x: any) => x.status === 'PENDING' || x.status === 'ACKNOWLEDGED'))
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not load presence data.')
    } finally {
      setLoading(false)
    }
  }

  const ackSos = async (id: string) => {
    try {
      await api.post(`/sos/${id}/acknowledge`)
      fetchAll()
    } catch {}
  }

  const resolveSos = async (id: string) => {
    try {
      await api.post(`/sos/${id}/resolve`)
      fetchAll()
    } catch {}
  }

  const exportCsv = () => {
    const rows = [['Name', 'Phone/Email', 'Floor hint', 'Checked in']]
    list.forEach((p) => {
      rows.push([
        p.user?.name || p.guestName || 'Guest',
        p.user?.phone || p.user?.email || p.guestPhone || '',
        p.floorHint || '',
        new Date(p.checkedInAt).toLocaleString(),
      ])
    })
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `presence-${selected}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live presence & SOS"
        subtitle="Who is checked in right now and who needs help."
        action={
          <div className="flex gap-2">
            <select className="input w-52" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <button onClick={exportCsv} disabled={!list.length} className="btn-secondary btn-sm">Export CSV</button>
          </div>
        }
      />

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {sos.length > 0 && (
        <div className="card border-red-200 bg-red-50/50">
          <h2 className="font-semibold text-red-900 mb-3">Active SOS requests ({sos.length})</h2>
          <div className="space-y-2">
            {sos.map((s) => (
              <div key={s.id} className="bg-white border border-red-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm text-gray-900">{s.user?.name || 'Guest'} · {s.location || 'No location'}</p>
                  <p className="text-xs text-gray-600">{s.message || 'No message'} · {new Date(s.timestamp).toLocaleTimeString()}</p>
                </div>
                <div className="flex gap-2">
                  <span className={s.status === 'PENDING' ? 'badge-red' : 'badge-blue'}>{s.status}</span>
                  {s.status === 'PENDING' && <button onClick={() => ackSos(s.id)} className="btn-secondary btn-sm">Acknowledge</button>}
                  <button onClick={() => resolveSos(s.id)} className="btn-success btn-sm">Resolve</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold mb-1">Checked in now</h2>
        <p className="text-sm text-gray-500 mb-4">{list.length} {list.length === 1 ? 'person' : 'people'} inside</p>
        {loading ? (
          <LoadingState label="Loading presence…" />
        ) : list.length === 0 ? (
          <EmptyState icon={<UsersIcon className="w-12 h-12" />} title="Nobody checked in" hint="Visitors appear here after scanning the building QR." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-head px-4 py-3">Name</th>
                  <th className="table-head px-4 py-3">Contact</th>
                  <th className="table-head px-4 py-3">Location hint</th>
                  <th className="table-head px-4 py-3">Checked in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.user?.name || p.guestName || 'Guest'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.user?.phone || p.user?.email || p.guestPhone || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.floorHint || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{new Date(p.checkedInAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
