import { useNavigate } from 'react-router-dom'
import { Atom, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import ContentPanel from '../components/ContentPanel'
import BatchesPanel from '../components/BatchesPanel'

// The post-login home: a full-screen page split into two halves —
// Content Creation (left) and Batches (right).
export default function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="app-bg flex h-screen flex-col">
      <header className="glass flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
            <Atom className="h-4.5 w-4.5" />
          </span>
          <span className="text-base font-bold tracking-tight text-slate-100">
            Physics<span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">Board</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {user && <span className="hidden text-sm text-slate-400 sm:inline">{user.email || user.phoneNumber}</span>}
          <button onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:border-white/20 hover:bg-white/5 hover:text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        <section className="min-h-0 border-b border-white/8 md:border-b-0 md:border-r">
          <ContentPanel />
        </section>
        <section className="min-h-0">
          <BatchesPanel />
        </section>
      </div>
    </div>
  )
}
