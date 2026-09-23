import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIFETIME, lastDays, type DateRange } from '../lib/dateRange'
import PeriodSelector from './PeriodSelector'

// Tests run in America/Sao_Paulo (UTC-3); see vite.config.ts.
const TODAY = new Date(2026, 8, 23, 10, 15)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: TODAY })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Renders the selector with its state held by a parent, like History. */
function renderSelector(initial: DateRange = lastDays(30, TODAY)) {
  const onChange = vi.fn<(range: DateRange) => void>()
  function Parent() {
    const [value, setValue] = useState(initial)
    return (
      <PeriodSelector
        value={value}
        onChange={(range) => {
          onChange(range)
          setValue(range)
        }}
      />
    )
  }
  render(<Parent />)
  return onChange
}

function preset(name: string) {
  return screen.getByRole('button', { name })
}

describe('PeriodSelector', () => {
  it.each([
    ['7 days', { start: '2026-09-17', end: '2026-09-23' }],
    ['10 days', { start: '2026-09-14', end: '2026-09-23' }],
    ['30 days', { start: '2026-08-25', end: '2026-09-23' }],
    ['90 days', { start: '2026-06-26', end: '2026-09-23' }],
    ['Lifetime', { start: null, end: null }],
  ])('"%s" emits %j', async (name, expected) => {
    const onChange = renderSelector(
      name === '30 days' ? LIFETIME : lastDays(30, TODAY),
    )

    await userEvent.click(preset(name))

    expect(onChange).toHaveBeenLastCalledWith(expected)
    expect(preset(name)).toHaveAttribute('aria-pressed', 'true')
  })

  it('marks the preset matching the current value', () => {
    renderSelector(lastDays(90, TODAY))

    expect(preset('90 days')).toHaveAttribute('aria-pressed', 'true')
    for (const other of [
      '7 days',
      '10 days',
      '30 days',
      'Lifetime',
      'Custom',
    ]) {
      expect(preset(other)).toHaveAttribute('aria-pressed', 'false')
    }
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
  })

  describe('custom range', () => {
    it('accepts a start and an end date', async () => {
      const onChange = renderSelector()

      await userEvent.click(preset('Custom'))
      fireEvent.change(screen.getByLabelText('From'), {
        target: { value: '2026-09-01' },
      })
      fireEvent.change(screen.getByLabelText('To'), {
        target: { value: '2026-09-15' },
      })

      expect(onChange).toHaveBeenLastCalledWith({
        start: '2026-09-01',
        end: '2026-09-15',
      })
      expect(preset('Custom')).toHaveAttribute('aria-pressed', 'true')
      expect(preset('Custom')).toHaveAttribute('aria-expanded', 'true')
    })

    it('starts from the current range and limits the dates to today', async () => {
      renderSelector(lastDays(7, TODAY))

      await userEvent.click(preset('Custom'))

      expect(screen.getByLabelText('From')).toHaveValue('2026-09-17')
      expect(screen.getByLabelText('To')).toHaveValue('2026-09-23')
      expect(screen.getByLabelText('From')).toHaveAttribute('max', '2026-09-23')
      expect(screen.getByLabelText('To')).toHaveAttribute('max', '2026-09-23')
    })

    it('rejects a start after the end, with an accessible error', async () => {
      const onChange = renderSelector()
      await userEvent.click(preset('Custom'))
      onChange.mockClear()

      fireEvent.change(screen.getByLabelText('From'), {
        target: { value: '2026-09-20' },
      })
      fireEvent.change(screen.getByLabelText('To'), {
        target: { value: '2026-09-10' },
      })

      expect(screen.getByRole('alert')).toHaveTextContent(
        'The start date must be on or before the end date.',
      )
      expect(screen.getByLabelText('To')).toHaveAttribute(
        'aria-invalid',
        'true',
      )
      expect(screen.getByLabelText('To')).toHaveAccessibleDescription(
        'The start date must be on or before the end date.',
      )
      expect(onChange).not.toHaveBeenCalledWith({
        start: '2026-09-20',
        end: '2026-09-10',
      })
    })

    it('waits until both dates are complete', async () => {
      const onChange = renderSelector()
      await userEvent.click(preset('Custom'))
      onChange.mockClear()

      fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } })

      expect(onChange).not.toHaveBeenCalled()
    })

    it('opens directly when the current value matches no preset', () => {
      renderSelector({ start: '2026-09-01', end: '2026-09-15' })

      expect(preset('Custom')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByLabelText('From')).toHaveValue('2026-09-01')
    })
  })
})
