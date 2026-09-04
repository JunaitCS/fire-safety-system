import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../utils/api'
import { PageHeader, LoadingState, ErrorState, EmptyState } from '../../components/ui'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'

interface Complaint {
  id: string
  buildingId: string
  type: string
  message: string
  status: string
  createdAt: string
  user?: { id: string; name: string }
}

const STATUS_STYLES: Record<string, string> = {
  open: 'badge-amber',
  in_progress: 'badge-blue',
  resolved: 'badge-green',
}

export default function ComplaintsInbox() {
  const { buildingId } = useParams()
  const [buildings, setBuildings] = useState<any[]>([])
  const [selected, setSelected] = useState(buildingId || '')
  const [items, setItems] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    api.get('/buildings').then((r) => {
      setBuildings(r.data)
      if (!selected && r.data.length) setSelected(buildingId || r.data[0].id)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selected) fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const fetchItems = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/complaints/building/${selected}`)
      setItems(res.data)
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not load safety reports.')
    } finally {
      setLoading(false)
    }
  }

  const setStatus = async (id: string, status: string) => {
    try {
      await api.put(`/complaints/${id}`, { status })
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))
    } catch {
      setError('Failed to update report status.')
    }
  }

  const visible = items.filter((c) => (filter === 'all' ? true : c.status === filter))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Safety reports"
        subtitle="Occupant-submitted hazards, blocked exits and maintenance requests."
        action={
          <div className="flex gap-2">
            <select className="input w-52" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select className="input w-36" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        }
      />

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {loading ? (
        <LoadingState label="Loading reports…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ChatBubbleLeftRightIcon className="w-14 h-14" />}
          title="No reports"
          hint={items.length ? 'No reports match this filter.' : 'When occupants report hazards, they will appear here.'}
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-head px-6 py-3">Report</th>
                  <th className="table-head px-6 py-3">Type</th>
                  <th className="table-head px-6 py-3">Reporter</th>
                  <th className="table-head px-6 py-3">Status</th>
                  <th className="table-head px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {visible.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 max-w-md">
                      <p className="text-sm text-gray-900">{c.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{new Date(c.createdAt).toLocaleString()}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 capitalize">{c.type}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{c.user?.name || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={STATUS_STYLES[c.status] || 'badge-gray'}>{c.status.replace('_', ' ')}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {c.status === 'open' && (
                          <button onClick={() => setStatus(c.id, 'in_progress')} className="btn-secondary btn-sm">Start work</button>
                        )}
                        {c.status !== 'resolved' && (
                          <button onClick={() => setStatus(c.id, 'resolved')} className="btn-success btn-sm">Resolve</button>
                        )}
                        {c.status === 'resolved' && (
                          <button onClick={() => setStatus(c.id, 'open')} className="btn-secondary btn-sm">Reopen</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
