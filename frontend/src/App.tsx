import type { ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'

import MainLayout from './components/layouts/MainLayout'

import Login from './pages/Login'
import Register from './pages/Register'

import ManagerDashboard from './pages/manager/Dashboard'
import BuildingManager from './pages/manager/BuildingManager'
import FloorDesigner from './pages/manager/FloorDesigner'
import CameraManager from './pages/manager/CameraManager'
import CameraTest from './pages/manager/CameraTest'
import DrillManager from './pages/manager/DrillManager'
import FireEmergencyConsole from './pages/manager/FireEmergencyConsole'
import Analytics from './pages/manager/Analytics'
import ComplaintsInbox from './pages/manager/ComplaintsInbox'
import PresenceBoard from './pages/manager/PresenceBoard'

import OccupantDashboard from './pages/occupant/Dashboard'
import BuildingInfo from './pages/occupant/BuildingInfo'
import EmergencyView from './pages/occupant/EmergencyView'

import ResponderDashboard from './pages/responder/Dashboard'
import EmergencyMonitor from './pages/responder/EmergencyMonitor'
import OccupancyView from './pages/responder/OccupancyView'

function ProtectedRoute({ children, allowedRoles }: { children: ReactNode; allowedRoles: string[] }) {
  const { user, token } = useAuthStore()
  
  if (!token || !user) {
    return <Navigate to="/login" replace />
  }
  
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />
  }
  
  return <MainLayout>{children}</MainLayout>
}

function App() {
  const { user, getDashboardRoute } = useAuthStore()

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/building/:qrCode" element={<BuildingInfo />} />
      
      <Route path="/manager" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <ManagerDashboard />
        </ProtectedRoute>
      } />
      <Route path="/manager/buildings" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <BuildingManager />
        </ProtectedRoute>
      } />
      <Route path="/manager/floors/:buildingId" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <FloorDesigner />
        </ProtectedRoute>
      } />
      <Route path="/manager/cameras/:buildingId" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <CameraManager />
        </ProtectedRoute>
      } />
      <Route path="/manager/cameras/:buildingId/test" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <CameraTest />
        </ProtectedRoute>
      } />
      <Route path="/manager/camera-test" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <CameraTest />
        </ProtectedRoute>
      } />

      <Route path="/manager/drills/:buildingId" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <DrillManager />
        </ProtectedRoute>
      } />
      <Route path="/manager/drills" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <DrillManager />
        </ProtectedRoute>
      } />
      <Route path="/manager/emergency" element={
        <ProtectedRoute allowedRoles={['MANAGER', 'RESPONDER']}>
          <FireEmergencyConsole />
        </ProtectedRoute>
      } />
      <Route path="/manager/analytics/:buildingId" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <Analytics />
        </ProtectedRoute>
      } />
      <Route path="/manager/analytics" element={
        <ProtectedRoute allowedRoles={['MANAGER']}>
          <Analytics />
        </ProtectedRoute>
      } />
      <Route path="/manager/complaints/:buildingId" element={
        <ProtectedRoute allowedRoles={['MANAGER', 'RESPONDER']}>
          <ComplaintsInbox />
        </ProtectedRoute>
      } />
      <Route path="/manager/complaints" element={
        <ProtectedRoute allowedRoles={['MANAGER', 'RESPONDER']}>
          <ComplaintsInbox />
        </ProtectedRoute>
      } />
      <Route path="/manager/presence/:buildingId" element={
        <ProtectedRoute allowedRoles={['MANAGER', 'RESPONDER']}>
          <PresenceBoard />
        </ProtectedRoute>
      } />
      <Route path="/manager/presence" element={
        <ProtectedRoute allowedRoles={['MANAGER', 'RESPONDER']}>
          <PresenceBoard />
        </ProtectedRoute>
      } />
      
      <Route path="/occupant" element={
        <ProtectedRoute allowedRoles={['OCCUPANT', 'MANAGER', 'RESPONDER']}>
          <OccupantDashboard />
        </ProtectedRoute>
      } />
      <Route path="/occupant/emergency" element={
        <ProtectedRoute allowedRoles={['OCCUPANT', 'MANAGER', 'RESPONDER']}>
          <EmergencyView />
        </ProtectedRoute>
      } />
      
      <Route path="/responder" element={
        <ProtectedRoute allowedRoles={['RESPONDER', 'MANAGER']}>
          <ResponderDashboard />
        </ProtectedRoute>
      } />
      <Route path="/responder/emergency/:emergencyId" element={
        <ProtectedRoute allowedRoles={['RESPONDER', 'MANAGER']}>
          <EmergencyMonitor />
        </ProtectedRoute>
      } />
      <Route path="/responder/occupancy/:buildingId" element={
        <ProtectedRoute allowedRoles={['RESPONDER', 'MANAGER']}>
          <OccupancyView />
        </ProtectedRoute>
      } />
      <Route path="/responder/occupancy" element={
        <ProtectedRoute allowedRoles={['RESPONDER', 'MANAGER']}>
          <OccupancyView />
        </ProtectedRoute>
      } />
      
      <Route path="/" element={
        user ? <Navigate to={getDashboardRoute()} replace /> : <Navigate to="/login" replace />
      } />
      <Route path="*" element={
        user ? <Navigate to={getDashboardRoute()} replace /> : <Navigate to="/login" replace />
      } />
    </Routes>
  )
}

export default App
