/** Small shared controls for the in-presentation editor sidebars. */

export function PanelSection({ icon: Icon, title, right, children }) {
  return (
    <section className="border-b border-white/8 px-3 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-indigo-400" />}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </section>
  )
}

export function Btn({ children, active, danger, wide, ...p }) {
  return (
    <button
      type="button"
      {...p}
      className={[
        'inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition',
        wide ? 'w-full' : '',
        p.disabled ? 'cursor-not-allowed opacity-35' : '',
        danger
          ? 'border-red-500/25 bg-red-500/10 text-red-300 hover:border-red-400/50 hover:bg-red-500/20'
          : active
            ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
            : 'border-white/10 bg-white/5 text-slate-300 hover:border-indigo-400/40 hover:bg-white/10 hover:text-slate-100',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function IconBtn({ children, title, danger, ...p }) {
  return (
    <button
      type="button"
      title={title}
      {...p}
      className={`rounded-md p-1.5 text-slate-500 transition disabled:opacity-30 ${
        danger ? 'hover:bg-red-500/15 hover:text-red-400' : 'hover:bg-white/10 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

export function Hint({ children }) {
  return <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{children}</p>
}

export function Empty({ children }) {
  return (
    <div className="rounded-lg border border-dashed border-white/12 px-3 py-4 text-center text-[11px] text-slate-500">
      {children}
    </div>
  )
}
