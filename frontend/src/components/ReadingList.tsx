import { formatDateTime } from '../lib/format'
import type { Reading } from '../types'

interface ReadingListProps {
  readings: Reading[]
  onDelete: (reading: Reading) => void
  /** ID of the reading being deleted, if any. */
  deletingId: number | null
}

function deleteLabel(reading: Reading): string {
  return `Delete reading of ${formatDateTime(reading.reading_datetime)}, ${reading.systolic}/${reading.diastolic} mmHg`
}

const deleteButtonClass =
  'min-h-11 rounded-md border border-red-700 px-3 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Readings, newest first: stacked cards on small screens, a table from md up.
 * Only one of the two is displayed (display: none also hides the other from
 * screen readers).
 */
export default function ReadingList({
  readings,
  onDelete,
  deletingId,
}: ReadingListProps) {
  return (
    <>
      <ul aria-label="Readings" className="space-y-3 md:hidden">
        {readings.map((reading) => (
          <li
            key={reading.id}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-slate-600">
                  <time dateTime={reading.reading_datetime}>
                    {formatDateTime(reading.reading_datetime)}
                  </time>
                </p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {reading.systolic}/{reading.diastolic}{' '}
                  <span className="text-base font-normal text-slate-600">
                    mmHg
                  </span>
                </p>
                {(reading.pulse !== null || reading.weight !== null) && (
                  <p className="mt-1 text-slate-700">
                    {reading.pulse !== null && <>Pulse {reading.pulse} bpm</>}
                    {reading.pulse !== null && reading.weight !== null && ' · '}
                    {reading.weight !== null && <>Weight {reading.weight} kg</>}
                  </p>
                )}
                {reading.notes && (
                  <p className="mt-1 text-sm text-slate-600">{reading.notes}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDelete(reading)}
                disabled={deletingId === reading.id}
                aria-label={deleteLabel(reading)}
                className={deleteButtonClass}
              >
                {deletingId === reading.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <table className="hidden w-full border-collapse overflow-hidden rounded-lg bg-white text-left md:table">
        <caption className="sr-only">Readings, newest first</caption>
        <thead className="border-b border-slate-200 text-sm text-slate-600">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Date and time
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Blood pressure (mmHg)
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Pulse (bpm)
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Weight (kg)
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Notes
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {readings.map((reading) => (
            <tr key={reading.id}>
              <td className="px-4 py-3 text-slate-700">
                <time dateTime={reading.reading_datetime}>
                  {formatDateTime(reading.reading_datetime)}
                </time>
              </td>
              <td className="px-4 py-3 font-semibold text-slate-900">
                {reading.systolic}/{reading.diastolic}
              </td>
              <td className="px-4 py-3 text-slate-700">
                {reading.pulse ?? '—'}
              </td>
              <td className="px-4 py-3 text-slate-700">
                {reading.weight ?? '—'}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {reading.notes}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onDelete(reading)}
                  disabled={deletingId === reading.id}
                  aria-label={deleteLabel(reading)}
                  className={deleteButtonClass}
                >
                  {deletingId === reading.id ? 'Deleting…' : 'Delete'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
