import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Loader from './Loader'

// Guards a route so only signed-in users can see it.
//
// It is also what makes `userScope.js` safe: nothing below this component
// renders until Firebase has resolved the session, so by the time any data
// layer builds a `users/{uid}/…` path there is always a current user.
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Loader label="Checking your session…" />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />

  return children
}
