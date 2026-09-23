/** Shown while the session is being restored after a page load. */
export default function SessionLoading() {
  return (
    <p
      role="status"
      className="py-12 text-center text-slate-700 dark:text-slate-300"
    >
      Loading…
    </p>
  )
}
