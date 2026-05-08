import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Analytics from './Analytics.jsx'
import Timeline from './Timeline.jsx'
import LoginPage from './LoginPage.jsx'
import DashboardPage from './DashboardPage.jsx'
import ProtectedRoute from './ProtectedRoute.jsx'
import { AuthProvider } from './AuthContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public route */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/draw/:drawingId"
            element={
              <ProtectedRoute>
                <App />
              </ProtectedRoute>
            }
          />

          {/* Global pages (still protected) */}
          <Route
            path="/analytics"
            element={
              <ProtectedRoute>
                <Analytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/timeline"
            element={
              <ProtectedRoute>
                <Timeline />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

document.body.classList.add('app-mounted')
