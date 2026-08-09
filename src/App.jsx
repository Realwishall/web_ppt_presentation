import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import PresenterView from './pages/PresenterView'
import DeckEditorView from './pages/DeckEditorView'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Post-login home: two-part page (content creation + batches). */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* Live teaching presenter panel (loads a folder's HTML from the Library). */}
      <Route
        path="/teach"
        element={
          <ProtectedRoute>
            <PresenterView />
          </ProtectedRoute>
        }
      />

      {/* In-presentation editor: the same slide the presenter shows, at the
          same proportions, with editing controls instead of board tools. */}
      <Route
        path="/edit"
        element={
          <ProtectedRoute>
            <DeckEditorView />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
