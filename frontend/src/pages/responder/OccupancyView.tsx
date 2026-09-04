import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../utils/api'
import { UsersIcon, VideoCameraIcon } from '@heroicons/react/24/outline'

export default function OccupancyView() {
  const { buildingId } = useParams()
  const [buildings, setBuildings] = useState<any[]>([])
  const [selected, setSelected] = useState(buildingId || '')
  const [cameras, setCameras] = useState<any[]>([])

  useEffect(() => {
    api.get('/buildings').then((r) => {
      setBuildings(r.data)
      if (!selected && r.data.length) setSelected(r.data[0].id)
    })
  }, [])

  useEffect(() => {
    if (selected) {
      api.get(`/cameras/building/${selected}`).then((r) => setCameras(r.data)).catch(() => {})
    }
  }, [selected])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Occupancy Monitor</h1>
          <p className="text-gray-600">Live person counts from building cameras</p>
        </div>
        <select className="input w-48" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cameras.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <VideoCameraIcon className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold">{c.name}</h3>
                <p className="text-xs text-gray-500">{c.floor?.name || 'No floor'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <UsersIcon className="w-4 h-4 text-gray-400" />
              <span className="text-gray-600">Detections recorded: {c._count?.detections || 0}</span>
            </div>
            {c.isExit && (
              <span className="inline-block mt-2 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded">Exit camera</span>
            )}
          </div>
        ))}
      </div>

      {cameras.length === 0 && (
        <div className="card text-center py-12">
          <UsersIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">No cameras configured for this building</p>
        </div>
      )}
    </div>
  )
}
