import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../utils/api'
import {
  BuildingOfficeIcon,
  VideoCameraIcon,
  FireIcon,
  UsersIcon,
  ArrowTrendingUpIcon,
  PlusIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline'
import { PageHeader, LoadingState, ErrorState } from '../../components/ui'

interface Building {
  id: string
  name: string
  address: string
  _count: {
    floors: number
    cameras: number
  }
}

interface Stats {
  totalBuildings: number
  totalCameras: number
  activeDrills: number
  totalOccupants: number
}

export default function ManagerDashboard() {
  const [buildings, setBuildings] = useState<Building[]>([])
  const [stats, setStats] = useState<Stats>({
    totalBuildings: 0,
    totalCameras: 0,
    activeDrills: 0,
    totalOccupants: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setError('')
    try {
      const [buildingsRes, drillsRes] = await Promise.all([
        api.get('/buildings'),
        api.get('/emergency/active'),
      ])

      setBuildings(buildingsRes.data)

      const totalCameras = buildingsRes.data.reduce(
        (sum: number, b: Building) => sum + (b._count?.cameras || 0), 0
      )

      let totalOccupants = 0
      try {
        const counts = await Promise.all(
          buildingsRes.data.map((b: Building) =>
            api.get(`/presence/building/${b.id}/count`).then((r) => r.data.count).catch(() => 0)
          )
        )
        totalOccupants = counts.reduce((a: number, c: number) => a + c, 0)
      } catch { /* keep 0 */ }

      setStats({
        totalBuildings: buildingsRes.data.length,
        totalCameras,
        activeDrills: drillsRes.data.length,
        totalOccupants,
      })
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load dashboard data.')
      console.error('Error fetching dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations overview"
        subtitle="Buildings, occupancy, emergencies and evacuation readiness at a glance."
        action={
          <Link to="/manager/buildings" className="btn-primary">
            <PlusIcon className="w-5 h-5" /> Add Building
          </Link>
        }
      />

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Buildings" value={stats.totalBuildings} icon={BuildingOfficeIcon} color="blue" />
        <StatCard title="Active Cameras" value={stats.totalCameras} icon={VideoCameraIcon} color="green" />
        <StatCard title="Active Emergencies" value={stats.activeDrills} icon={FireIcon} color="orange" />
        <StatCard title="Total Occupants" value={stats.totalOccupants} icon={UsersIcon} color="purple" />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Your Buildings</h2>
          <Link to="/manager/buildings" className="text-blue-600 hover:text-blue-700 text-sm font-medium">
            View All
          </Link>
        </div>

        {loading ? (
          <LoadingState label="Loading buildings…" />
        ) : buildings.length === 0 ? (
          <div className="text-center py-12">
            <BuildingOfficeIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No buildings yet</h3>
            <p className="text-gray-600 mb-4">Add your first building to get started</p>
            <Link to="/manager/buildings" className="btn-primary">Add Building</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {buildings.map((building) => (
              <Link
                key={building.id}
                to={`/manager/floors/${building.id}`}
                className="card card-hover p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <BuildingOfficeIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                    {building._count?.floors || 0} floors
                  </span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{building.name}</h3>
                <p className="text-sm text-gray-600 line-clamp-2">{building.address}</p>
                <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <VideoCameraIcon className="w-4 h-4" />
                    {building._count?.cameras || 0} cameras
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/manager/drills" className="p-4 border border-gray-200 rounded-lg hover:bg-orange-50 hover:border-orange-200 transition-colors">
            <FireIcon className="w-6 h-6 text-gray-600 mb-2" />
            <h3 className="font-medium text-gray-900 text-sm">Run Drill</h3>
            <p className="text-xs text-gray-500 mt-1">Start a live evacuation drill</p>
          </Link>
          <Link to="/manager/presence" className="p-4 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-200 transition-colors">
            <UsersIcon className="w-6 h-6 text-gray-600 mb-2" />
            <h3 className="font-medium text-gray-900 text-sm">Live Presence</h3>
            <p className="text-xs text-gray-500 mt-1">See who is checked in</p>
          </Link>
          <Link to="/manager/complaints" className="p-4 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-200 transition-colors">
            <ChatBubbleLeftRightIcon className="w-6 h-6 text-gray-600 mb-2" />
            <h3 className="font-medium text-gray-900 text-sm">Safety Reports</h3>
            <p className="text-xs text-gray-500 mt-1">Review and resolve issues</p>
          </Link>
          <Link to="/manager/analytics" className="p-4 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-colors">
            <ArrowTrendingUpIcon className="w-6 h-6 text-gray-600 mb-2" />
            <h3 className="font-medium text-gray-900 text-sm">View Analytics</h3>
            <p className="text-xs text-gray-500 mt-1">Check evacuation stats</p>
          </Link>
        </div>
      </div>
    </div>
  )
}

function StatCard({ title, value, icon: Icon, color }: {
  title: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  color: string
}) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
    purple: 'bg-purple-50 text-purple-600',
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  )
}
