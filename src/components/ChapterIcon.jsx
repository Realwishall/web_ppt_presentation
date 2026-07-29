// Renders a chapter's inline SVG icon string (a ~48x48 rounded gradient tile).
// Falls back to a neutral tile if no SVG was provided.
export default function ChapterIcon({ svg, size = 48, className = '' }) {
  if (svg) {
    return (
      <span
        className={`inline-flex shrink-0 ${className}`}
        style={{ width: size, height: size }}
        // svgIcon is authored content stored in Firestore by the admin.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-300 to-slate-400 text-white ${className}`}
      style={{ width: size, height: size }}
    >
      ?
    </span>
  )
}
