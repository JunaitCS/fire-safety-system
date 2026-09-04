import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useSocketStore } from '../../store/socketStore'
import {
  HomeIcon,
  BuildingOfficeIcon,
  VideoCameraIcon,
  FireIcon,
  ChartBarIcon,
  PhoneIcon,
  ShieldCheckIcon,
  Bars3Icon,
  XMarkIcon,
  ArrowLeftOnRectangleIcon,
  ChatBubbleLeftRightIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'

export default function Sidebar() {
  const { user, logout, getDashboardRoute } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const handleLogout = () => {
    const { disconnect } = useSocketStore.getState()
    disconnect()
    logout()
    navigate('/login')
  }

  const getNavigation = () => {
    switch (user?.role) {
      case 'MANAGER':
        return [
          { name: 'Dashboard', href: '/manager', icon: HomeIcon },
          { name: 'Buildings', href: '/manager/buildings', icon: BuildingOfficeIcon },
          { name: 'Fire Emergency', href: '/manager/emergency', icon: FireIcon },
          { name: 'Presence', href: '/manager/presence', icon: UsersIcon },
          { name: 'Complaints', href: '/manager/complaints', icon: ChatBubbleLeftRightIcon },
          { name: 'Drills', href: '/manager/drills', icon: FireIcon },
          { name: 'Camera Test', href: '/manager/camera-test', icon: VideoCameraIcon },
          { name: 'Analytics', href: '/manager/analytics', icon: ChartBarIcon },
        ]
      case 'RESPONDER':
        return [
          { name: 'Dashboard', href: '/responder', icon: HomeIcon },
          { name: 'Fire Emergency', href: '/manager/emergency', icon: FireIcon },
          { name: 'Occupancy Monitor', href: '/responder/occupancy', icon: VideoCameraIcon },
          { name: 'Presence', href: '/manager/presence', icon: UsersIcon },
          { name: 'Complaints', href: '/manager/complaints', icon: ChatBubbleLeftRightIcon },
        ]
      case 'OCCUPANT':
      default:
        return [
          { name: 'Dashboard', href: '/occupant', icon: HomeIcon },
          { name: 'Emergency', href: '/occupant/emergency', icon: PhoneIcon },
        ]
    }
  }

  const navigation = getNavigation()

  return (
    <>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b px-4 py-3 flex items-center justify-between">
        <span className="font-bold text-lg text-gray-900">FireGuard Pro</span>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          {isMobileMenuOpen ? (
            <XMarkIcon className="w-6 h-6" />
          ) : (
            <Bars3Icon className="w-6 h-6" />
          )}
        </button>
      </div>

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r transform transition-transform duration-200 ease-in-out ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-full flex flex-col">
          <div className="p-6 border-b">
            <Link to={getDashboardRoute()} className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-orange-500 rounded-lg flex items-center justify-center">
                <ShieldCheckIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-lg text-gray-900">FireGuard Pro</h1>
                <p className="text-xs text-gray-500">Safety Management</p>
              </div>
            </Link>
          </div>

          <div className="p-4 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="font-semibold text-blue-600">
                  {user?.name?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-900 truncate">{user?.name}</p>
                <p className="text-xs text-gray-500 capitalize">{user?.role?.toLowerCase()}</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href || 
                             location.pathname.startsWith(item.href + '/')
              
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`nav-link ${isActive ? 'nav-link-active' : 'nav-link-inactive'}`}
                >
                  <item.icon className={`w-5 h-5 mr-3 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                  {item.name}
                </Link>
              )
            })}
          </nav>

          <div className="p-4 border-t">
            <button
              onClick={handleLogout}
              className="nav-link nav-link-inactive w-full text-left"
            >
              <ArrowLeftOnRectangleIcon className="w-5 h-5 mr-3 text-gray-400" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  )
}
