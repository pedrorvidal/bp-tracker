import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import FormField from '../components/FormField'
import { useCreateReading } from '../hooks/useReadings'
import { isApiError } from '../lib/api'
import { toDateTimeLocalValue } from '../lib/datetime'
import {
  FIELD_ORDER,
  LIMITS,
  validateReading,
  type ReadingFormErrors,
  type ReadingFormField,
  type ReadingFormValues,
} from '../lib/readingForm'
import type { Reading } from '../types'

function emptyValues(): ReadingFormValues {
  return {
    reading_datetime: toDateTimeLocalValue(new Date()),
    systolic: '',
    diastolic: '',
    pulse: '',
    weight: '',
    notes: '',
  }
}

/** Maps a 400 rest_invalid_param from the API to field errors, if it names our fields. */
function serverFieldErrors(error: unknown): ReadingFormErrors | null {
  if (!isApiError(error) || error.response?.status !== 400) {
    return null
  }
  const params = error.response.data.data.params
  if (!params || Array.isArray(params)) {
    return null
  }

  const errors: ReadingFormErrors = {}
  for (const field of FIELD_ORDER) {
    const message = params[field]
    if (typeof message === 'string') {
      errors[field] = message
    }
  }
  return Object.keys(errors).length > 0 ? errors : null
}

function describeSaved(reading: Reading): string {
  const when = new Date(reading.reading_datetime).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const pulse = reading.pulse === null ? '' : `, pulse ${reading.pulse}`
  return `Reading saved: ${reading.systolic}/${reading.diastolic} mmHg${pulse}, ${when}.`
}

const inputClass =
  'block min-h-12 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-lg text-slate-900 shadow-sm focus:border-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 aria-invalid:border-red-700'

export default function NewReading() {
  const [values, setValues] = useState<ReadingFormValues>(emptyValues)
  const [errors, setErrors] = useState<ReadingFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Reading | null>(null)
  const createReading = useCreateReading()
  const controls = useRef<
    Partial<Record<ReadingFormField, HTMLInputElement | HTMLTextAreaElement>>
  >({})

  function register(field: ReadingFormField) {
    return {
      name: field,
      value: values[field],
      ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => {
        if (element) {
          controls.current[field] = element
        }
      },
      onChange: (
        event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => {
        const { value } = event.target
        setValues((current) => ({ ...current, [field]: value }))
        setSaved(null)
        // An edited field's old error no longer applies.
        setErrors((current) => {
          if (!current[field]) return current
          const next = { ...current }
          delete next[field]
          return next
        })
      },
    }
  }

  function showErrors(fieldErrors: ReadingFormErrors) {
    setErrors(fieldErrors)
    const first = FIELD_ORDER.find((field) => fieldErrors[field])
    if (first) {
      controls.current[first]?.focus()
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSaved(null)

    const result = validateReading(values)
    if ('errors' in result) {
      showErrors(result.errors)
      return
    }

    setErrors({})
    try {
      const reading = await createReading.mutateAsync(result.input)
      setValues(emptyValues())
      setSaved(reading)
    } catch (error) {
      const fieldErrors = serverFieldErrors(error)
      if (fieldErrors) {
        showErrors(fieldErrors)
      } else {
        setFormError(
          'Could not save the reading. Check your connection and try again.',
        )
      }
    }
  }

  const pending = createReading.isPending

  return (
    <section aria-labelledby="new-reading-heading" className="mx-auto max-w-xl">
      <h2
        id="new-reading-heading"
        className="text-xl font-semibold sm:text-2xl"
      >
        New reading
      </h2>

      {/* Always rendered, so screen readers announce the confirmation. */}
      <div role="status" className="mt-4 empty:hidden">
        {saved && (
          <p className="flex items-start gap-2 rounded-md border border-green-700 bg-green-50 px-4 py-3 text-base text-green-900">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="mt-0.5 size-5 shrink-0 fill-current"
            >
              <path d="M8.1 14.3 3.8 10l1.4-1.4 2.9 2.9 6.7-6.7 1.4 1.4z" />
            </svg>
            {describeSaved(saved)}
          </p>
        )}
      </div>

      {formError && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-base text-red-800"
        >
          {formError}
        </p>
      )}

      <form
        aria-labelledby="new-reading-heading"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="mt-6 space-y-5"
      >
        <FormField
          id="reading-datetime"
          label="Date and time"
          error={errors.reading_datetime}
        >
          {(control) => (
            <input
              {...control}
              {...register('reading_datetime')}
              type="datetime-local"
              required
              className={inputClass}
            />
          )}
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            id="reading-systolic"
            label="Systolic"
            hint={`Top number, mmHg (${LIMITS.systolic.min}–${LIMITS.systolic.max})`}
            error={errors.systolic}
          >
            {(control) => (
              <input
                {...control}
                {...register('systolic')}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                required
                className={inputClass}
              />
            )}
          </FormField>

          <FormField
            id="reading-diastolic"
            label="Diastolic"
            hint={`Bottom number, mmHg (${LIMITS.diastolic.min}–${LIMITS.diastolic.max})`}
            error={errors.diastolic}
          >
            {(control) => (
              <input
                {...control}
                {...register('diastolic')}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                required
                className={inputClass}
              />
            )}
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            id="reading-pulse"
            label="Pulse"
            hint="Beats per minute"
            optional
            error={errors.pulse}
          >
            {(control) => (
              <input
                {...control}
                {...register('pulse')}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className={inputClass}
              />
            )}
          </FormField>

          <FormField
            id="reading-weight"
            label="Weight"
            hint="kg"
            optional
            error={errors.weight}
          >
            {(control) => (
              <input
                {...control}
                {...register('weight')}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className={inputClass}
              />
            )}
          </FormField>
        </div>

        <FormField
          id="reading-notes"
          label="Notes"
          optional
          error={errors.notes}
        >
          {(control) => (
            <textarea
              {...control}
              {...register('notes')}
              rows={3}
              className={inputClass}
            />
          )}
        </FormField>

        <button
          type="submit"
          disabled={pending}
          className="min-h-12 w-full rounded-md bg-blue-700 px-4 py-3 text-lg font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
        >
          {pending ? 'Saving…' : 'Save reading'}
        </button>
      </form>
    </section>
  )
}
