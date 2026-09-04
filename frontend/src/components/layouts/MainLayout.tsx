import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useSocketStore } from '../../store/socketStore'
import Sidebar from './Sidebar'
import EmergencyAlert from '../EmergencyAlert'

interface MainLayoutProps {
  children: ReactNode
}

export default function MainLayout({ children }: MainLayoutProps) {
  const { connect } = useSocketStore()
  const location = useLocation()

  useEffect(() => {
    connect()
  }, [connect])

  const hideSidebar = location.pathname.includes('/building/') && !location.pathname.includes('/manager')

  if (hideSidebar) {
    return (
      <div className="min-h-screen bg-gray-50">
        <EmergencyAlert />
        {children}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col lg:ml-0">
        <div className="lg:hidden h-14" />
        <EmergencyAlert />
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
