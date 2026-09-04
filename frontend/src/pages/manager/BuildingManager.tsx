import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { getApiBase } from '../../utils/api'
import { PageHeader, LoadingState, ErrorState, EmptyState, ConfirmModal } from '../../components/ui'
import {
  BuildingOfficeIcon,
  PlusIcon,
  TrashIcon,
  MapIcon,
  VideoCameraIcon,
  QrCodeIcon,
  FireIcon,
  UsersIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline'

interface Building {
  id: string
  name: string
  address: string
  description?: string
  qrCode: string
  isPublic: boolean
  _count?: { floors: number; cameras: number }
}

export default function BuildingManager() {
  const [buildings, setBuildings] = useState<Building[]>([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', address: '', description: '', isPublic: true })
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [qr, setQr] = useState<{ image: string; building: Building; url: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Building | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    fetchBuildings()
  }, [])

  const fetchBuildings = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await api.get('/buildings')
      setBuildings(res.data)
    } catch (e: any) {
      setLoadError(e.response?.data?.error || 'Could not load buildings. Check that the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  const createBuilding = async () => {
    setFormError('')
    if (!form.name.trim() || !form.address.trim()) {
      setFormError('Building name and address are required.')
      return
    }
    setCreating(true)
    try {
      const res = await api.post('/buildings', {
        name: form.name.trim(),
        address: form.address.trim(),
        description: form.description.trim() || undefined,
        isPublic: form.isPublic,
      })
      setShowModal(false)
      setForm({ name: '', address: '', description: '', isPublic: true })
      if (res.data.qrImage) {
        setQr({
          image: res.data.qrImage,
          building: res.data,
          url: `${window.location.origin}/building/${res.data.qrCode}`,
        })
      }
      setNotice('Building created successfully.')
      fetchBuildings()
      setTimeout(() => setNotice(''), 4000)
    } catch (e: any) {
      setFormError(e.response?.data?.error || 'Failed to create building. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await api.delete(`/buildings/${pendingDelete.id}`)
      setPendingDelete(null)
      fetchBuildings()
    } catch {
      setLoadError('Failed to delete building.')
      setPendingDelete(null)
    }
  }

  const showQr = async (b: Building) => {
    try {
      const res = await api.get(`/buildings/${b.id}/qr`)
      setQr({ image: res.data.qrImage, building: b, url: res.data.url || `${window.location.origin}/building/${b.qrCode}` })
    } catch {
      setLoadError('Failed to generate QR code.')
    }
  }

  const downloadQr = () => {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr.image
    a.download = `${qr.building.name.replace(/\s+/g, '-').toLowerCase()}-qr.png`
    a.click()
  }

  const copyQrUrl = async () => {
    if (!qr) return
    try {
      await navigator.clipboard.writeText(qr.url)
      setNotice('QR link copied to clipboard.')
      setTimeout(() => setNotice(''), 3000)
    } catch {
      setNotice('Copy failed — long-press the link to copy manually.')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buildings"
        subtitle="Manage buildings, floor plans, cameras, occupancy and safety reports."
        action={
          <button onClick={() => { setFormError(''); setShowModal(true) }} className="btn-primary">
            <PlusIcon className="w-5 h-5" /> Add Building
          </button>
        }
      />

      {notice && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{notice}</div>
      )}

      {loading ? (
        <LoadingState label="Loading buildings…" />
      ) : loadError && buildings.length === 0 ? (
        <ErrorState message={loadError} onRetry={fetchBuildings} />
      ) : buildings.length === 0 ? (
        <EmptyState
          icon={<BuildingOfficeIcon className="w-14 h-14" />}
          title="No buildings yet"
          hint="Add your first building to configure floors, cameras and drills."
          action={<button onClick={() => setShowModal(true)} className="btn-primary mt-4">Add Building</button>}
        />
      ) : (
        <div className="grid gap-4">
          {loadError && <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">{loadError}</div>}
          {buildings.map((b) => (
            <div key={b.id} className="card card-hover flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0 border border-blue-100">
                  <BuildingOfficeIcon className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{b.name}</h3>
                    <span className={b.isPublic ? 'badge-green' : 'badge-gray'}>{b.isPublic ? 'Public' : 'Private'}</span>
                  </div>
                  <p className="text-gray-600 text-sm mt-0.5">{b.address}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>{b._count?.floors ?? 0} floors</span>
                    <span>{b._count?.cameras ?? 0} cameras</span>
                    <span className="font-mono">QR: {b.qrCode}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to={`/manager/floors/${b.id}`} className="btn-secondary btn-sm"><MapIcon className="w-4 h-4" /> Floors</Link>
                <Link to={`/manager/cameras/${b.id}`} className="btn-secondary btn-sm"><VideoCameraIcon className="w-4 h-4" /> Cameras</Link>
                <Link to={`/manager/drills/${b.id}`} className="btn-secondary btn-sm"><FireIcon className="w-4 h-4" /> Drills</Link>
                <Link to={`/manager/presence/${b.id}`} className="btn-secondary btn-sm"><UsersIcon className="w-4 h-4" /> Presence</Link>
                <Link to={`/manager/complaints/${b.id}`} className="btn-secondary btn-sm"><ChatBubbleLeftRightIcon className="w-4 h-4" /> Issues</Link>
                <button onClick={() => showQr(b)} className="btn-secondary btn-sm"><QrCodeIcon className="w-4 h-4" /> QR</button>
                <button onClick={() => setPendingDelete(b)} className="btn-secondary btn-sm !text-red-600 !border-red-200 hover:!bg-red-50" aria-label={`Delete ${b.name}`}>
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Add building</h2>
            <p className="text-sm text-gray-500 mt-1">A public QR check-in link is generated automatically.</p>
            {formError && <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{formError}</div>}
            <div className="space-y-4 mt-4">
              <div>
                <label className="label">Building name *</label>
                <input className="input" placeholder="e.g. Tech Plaza Tower" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Address *</label>
                <input className="input" placeholder="Street, city" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input h-20 resize-none" placeholder="Optional notes for occupants" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="rounded" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
                Public — visible via QR to occupants and responders
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="flex-1 btn-secondary" disabled={creating}>Cancel</button>
              <button onClick={createBuilding} className="flex-1 btn-primary" disabled={creating || !form.name.trim() || !form.address.trim()}>
                {creating ? 'Creating…' : 'Create building'}
              </button>
            </div>
          </div>
        </div>
      )}

      {qr && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setQr(null)}>
          <div className="bg-white rounded-xl p-6 text-center max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">{qr.building.name}</h3>
            <p className="text-xs text-gray-500 mt-1 break-all">{qr.url}</p>
            <img src={qr.image} alt={`QR code for ${qr.building.name}`} className="mx-auto w-52 h-52 mt-4 border rounded-lg" />
            <p className="text-xs text-gray-500 mt-3">Print this QR at entrances. Visitors scan to check in and receive alerts.</p>
            <div className="flex gap-2 mt-4">
              <button onClick={downloadQr} className="flex-1 btn-secondary btn-sm">Download PNG</button>
              <button onClick={copyQrUrl} className="flex-1 btn-secondary btn-sm">Copy link</button>
              <button onClick={() => setQr(null)} className="flex-1 btn-primary btn-sm">Done</button>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">API base: {getApiBase()}</p>
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={`Delete ${pendingDelete.name}?`}
          message="This permanently removes floors, cameras, drills and history for this building. This cannot be undone."
          confirmLabel="Delete building"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}
