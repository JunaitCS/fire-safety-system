import { useEffect, useState } from 'react'
import api from '../../utils/api'
import { ChartBarIcon, BuildingOfficeIcon, VideoCameraIcon, FireIcon } from '@heroicons/react/24/outline'

export default function Analytics() {
  const [buildings, setBuildings] = useState<any[]>([])
  const [selected, setSelected] = useState('')
  const [drills, setDrills] = useState<any[]>([])
  const [cameras, setCameras] = useState<any[]>([])

  useEffect(() => {
    api.get('/buildings').then((r) => {
      setBuildings(r.data)
      if (r.data.length) setSelected(r.data[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selected) return
    api.get(`/drills/building/${selected}`).then((r) => setDrills(r.data)).catch(() => {})
    api.get(`/cameras/building/${selected}`).then((r) => setCameras(r.data)).catch(() => {})
  }, [selected])

  const totalExits = drills.reduce((sum, d) => {
    return sum + (d.exitStats?.reduce((s: number, e: any) => s + e.exitCount, 0) || 0)
  }, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-gray-600">Evacuation performance and safety metrics</p>
        </div>
        <select className="input w-48" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card p-6">
          <BuildingOfficeIcon className="w-8 h-8 text-blue-600 mb-2" />
          <p className="text-3xl font-bold">{buildings.length}</p>
          <p className="text-sm text-gray-500">Buildings</p>
        </div>
        <div className="card p-6">
          <VideoCameraIcon className="w-8 h-8 text-green-600 mb-2" />
          <p className="text-3xl font-bold">{cameras.length}</p>
          <p className="text-sm text-gray-500">Cameras</p>
        </div>
        <div className="card p-6">
          <FireIcon className="w-8 h-8 text-orange-600 mb-2" />
          <p className="text-3xl font-bold">{drills.length}</p>
          <p className="text-sm text-gray-500">Total Drills</p>
        </div>
        <div className="card p-6">
          <ChartBarIcon className="w-8 h-8 text-purple-600 mb-2" />
          <p className="text-3xl font-bold">{totalExits}</p>
          <p className="text-sm text-gray-500">People Evacuated (tracked)</p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Recent Drills</h2>
        {drills.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No drill data yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Duration</th>
                  <th className="pb-2">Exits Tracked</th>
                </tr>
              </thead>
              <tbody>
                {drills.slice(0, 10).map((d) => (
                  <tr key={d.id} className="border-b">
                    <td className="py-3">{new Date(d.startTime).toLocaleDateString()}</td>
                    <td className="py-3 capitalize">{d.status}</td>
                    <td className="py-3">
                      {d.endTime
                        ? `${Math.round((new Date(d.endTime).getTime() - new Date(d.startTime).getTime()) / 60000)} min`
                        : 'In progress'}
                    </td>
                    <td className="py-3">{d.exitStats?.reduce((s: number, e: any) => s + e.exitCount, 0) || 0}</td>
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
