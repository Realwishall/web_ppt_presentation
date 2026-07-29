import { Atom } from 'lucide-react'

export default function Loader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-slate-400">
      <Atom className="h-10 w-10 animate-spin text-indigo-400" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  )
}
