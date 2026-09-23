import type { ReactNode } from 'react'

/** Props FormField hands to its control so label, hint and error are wired up. */
export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface FormFieldProps {
  id: string
  label: string
  /** Short help text, read by screen readers along with the label. */
  hint?: string
  /** Validation message; also marks the control aria-invalid. */
  error?: string
  optional?: boolean
  children: (control: FieldControlProps) => ReactNode
}

/**
 * A labelled form control with an optional hint and error message, both
 * associated with the control through aria-describedby.
 */
export default function FormField({
  id,
  label,
  hint,
  error,
  optional = false,
  children,
}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-base font-medium text-slate-900"
      >
        {label}
        {optional && (
          <span className="font-normal text-slate-600"> (optional)</span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-sm text-slate-600">
          {hint}
        </p>
      )}
      <div className="mt-1.5">
        {children({
          id,
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : undefined,
        })}
      </div>
      {error && (
        <p id={errorId} className="mt-1.5 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
    </div>
  )
}
