import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSession } from '../lib/authStore'
import { makeSession } from '../test/fixtures'
import {
  deferredReply,
  mockApi,
  restError,
  type MockReply,
} from '../test/mockApi'
import { renderWithProviders } from '../test/renderWithProviders'
import type { Reading } from '../types'
import NewReading from './NewReading'

// Tests run in America/Sao_Paulo (UTC-3); see vite.config.ts.
const NOW = new Date(2026, 8, 23, 8, 30)

const saved: Reading = {
  id: 7,
  reading_datetime: '2026-09-23T08:30:00-03:00',
  systolic: 118,
  diastolic: 76,
  pulse: 65,
  weight: 72.5,
  notes: 'After coffee',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  setSession(makeSession('a'))
})

afterEach(() => {
  vi.useRealTimers()
})

const field = {
  datetime: () => screen.getByLabelText('Date and time'),
  systolic: () => screen.getByLabelText('Systolic'),
  diastolic: () => screen.getByLabelText('Diastolic'),
  pulse: () => screen.getByLabelText('Pulse (optional)'),
  weight: () => screen.getByLabelText('Weight (optional)'),
  notes: () => screen.getByLabelText('Notes (optional)'),
}

function saveButton() {
  return screen.getByRole('button', { name: /save reading|saving/i })
}

async function fill(values: Partial<Record<keyof typeof field, string>>) {
  for (const [name, value] of Object.entries(values)) {
    const input = field[name as keyof typeof field]()
    await userEvent.clear(input)
    if (value !== '') {
      await userEvent.type(input, value)
    }
  }
}

describe('NewReading', () => {
  describe('accessibility', () => {
    it('labels every field and names the form', () => {
      renderWithProviders(<NewReading />)

      expect(
        screen.getByRole('form', { name: 'New reading' }),
      ).toBeInTheDocument()
      for (const get of Object.values(field)) {
        expect(get()).toBeInTheDocument()
      }
      expect(saveButton()).toHaveAccessibleName('Save reading')
    })

    it('associates each hint with its field', () => {
      renderWithProviders(<NewReading />)

      expect(field.systolic()).toHaveAccessibleDescription(
        'Top number, mmHg (60–250)',
      )
      expect(field.diastolic()).toHaveAccessibleDescription(
        'Bottom number, mmHg (40–150)',
      )
      expect(field.pulse()).toHaveAccessibleDescription('Beats per minute')
    })

    it('uses numeric keyboards on mobile and large touch targets', () => {
      renderWithProviders(<NewReading />)

      expect(field.systolic()).toHaveAttribute('inputmode', 'numeric')
      expect(field.diastolic()).toHaveAttribute('inputmode', 'numeric')
      expect(field.pulse()).toHaveAttribute('inputmode', 'numeric')
      expect(field.weight()).toHaveAttribute('inputmode', 'decimal')
      expect(field.systolic().className).toContain('min-h-12')
      expect(saveButton().className).toContain('min-h-12')
    })
  })

  it('defaults the date and time to now', () => {
    renderWithProviders(<NewReading />)

    expect(field.datetime()).toHaveValue('2026-09-23T08:30')
  })

  describe('valid submit', () => {
    it('sends the reading, confirms it and clears the form', async () => {
      const http = mockApi({ 'POST /readings': { status: 201, data: saved } })
      renderWithProviders(<NewReading />)

      await fill({
        systolic: '118',
        diastolic: '76',
        pulse: '65',
        weight: '72,5',
        notes: 'After coffee',
      })
      await userEvent.click(saveButton())

      expect(await screen.findByRole('status')).toHaveTextContent(
        /Reading saved: 118\/76 mmHg, pulse 65/,
      )
      expect(http.callsTo('POST /readings')).toHaveLength(1)
      expect(http.callsTo('POST /readings')[0]?.body).toEqual({
        reading_datetime: '2026-09-23T08:30:00-03:00',
        systolic: 118,
        diastolic: 76,
        pulse: 65,
        weight: 72.5,
        notes: 'After coffee',
      })
      expect(http.callsTo('POST /readings')[0]?.authorization).toBe(
        'Bearer access-a',
      )

      expect(field.systolic()).toHaveValue('')
      expect(field.diastolic()).toHaveValue('')
      expect(field.pulse()).toHaveValue('')
      expect(field.weight()).toHaveValue('')
      expect(field.notes()).toHaveValue('')
      expect(field.datetime()).toHaveValue('2026-09-23T08:30')
    })

    it('omits empty optional fields and uses the chosen date', async () => {
      const http = mockApi({ 'POST /readings': { status: 201, data: saved } })
      renderWithProviders(<NewReading />)

      await fill({
        datetime: '2026-09-20T21:15',
        systolic: '130',
        diastolic: '85',
      })
      await userEvent.click(saveButton())

      await screen.findByText(/Reading saved/)
      expect(http.callsTo('POST /readings')[0]?.body).toEqual({
        reading_datetime: '2026-09-20T21:15:00-03:00',
        systolic: 130,
        diastolic: 85,
      })
    })

    it('clears the confirmation once the user edits the form again', async () => {
      mockApi({ 'POST /readings': { status: 201, data: saved } })
      renderWithProviders(<NewReading />)

      await fill({ systolic: '118', diastolic: '76' })
      await userEvent.click(saveButton())
      await screen.findByText(/Reading saved/)

      await userEvent.type(field.systolic(), '1')

      expect(screen.queryByText(/Reading saved/)).not.toBeInTheDocument()
    })

    it('disables the button while saving', async () => {
      const pending = deferredReply()
      mockApi({ 'POST /readings': pending.handler })
      renderWithProviders(<NewReading />)

      await fill({ systolic: '118', diastolic: '76' })
      await userEvent.click(saveButton())

      expect(saveButton()).toHaveTextContent('Saving…')
      expect(saveButton()).toBeDisabled()

      pending.resolve({ status: 201, data: saved })
      await screen.findByText(/Reading saved/)
      expect(saveButton()).toBeEnabled()
    })
  })

  describe('invalid submit', () => {
    it('shows accessible errors, focuses the first invalid field and does not call the API', async () => {
      const http = mockApi({})
      renderWithProviders(<NewReading />)

      await fill({ systolic: '300', diastolic: '30' })
      await userEvent.click(saveButton())

      const systolic = field.systolic()
      const diastolic = field.diastolic()
      expect(systolic).toHaveAttribute('aria-invalid', 'true')
      expect(diastolic).toHaveAttribute('aria-invalid', 'true')
      expect(systolic).toHaveAccessibleDescription(
        'Systolic must be between 60 and 250. Top number, mmHg (60–250)',
      )
      expect(diastolic).toHaveAccessibleDescription(
        /Diastolic must be between 40 and 150\./,
      )
      expect(systolic).toHaveFocus()
      expect(http.calls).toHaveLength(0)
    })

    it('requires systolic and diastolic', async () => {
      const http = mockApi({})
      renderWithProviders(<NewReading />)

      await userEvent.click(saveButton())

      expect(screen.getByText('Enter the systolic value.')).toBeInTheDocument()
      expect(screen.getByText('Enter the diastolic value.')).toBeInTheDocument()
      expect(field.systolic()).toHaveFocus()
      expect(http.calls).toHaveLength(0)
    })

    it('rejects swapped values (systolic not above diastolic)', async () => {
      const http = mockApi({})
      renderWithProviders(<NewReading />)

      await fill({ systolic: '76', diastolic: '118' })
      await userEvent.click(saveButton())

      expect(field.systolic()).toHaveAccessibleDescription(
        /Systolic must be higher than diastolic\./,
      )
      expect(http.calls).toHaveLength(0)
    })

    it('validates the optional fields when filled', async () => {
      const http = mockApi({})
      renderWithProviders(<NewReading />)

      await fill({
        systolic: '118',
        diastolic: '76',
        pulse: '500',
        weight: '-2',
      })
      await userEvent.click(saveButton())

      expect(field.pulse()).toHaveAccessibleDescription(
        /Pulse must be between 30 and 220\./,
      )
      expect(field.weight()).toHaveAccessibleDescription(
        /Weight must be a positive number/,
      )
      expect(field.pulse()).toHaveFocus()
      expect(http.calls).toHaveLength(0)
    })

    it('clears a field error as soon as that field is edited', async () => {
      mockApi({})
      renderWithProviders(<NewReading />)

      await fill({ systolic: '300', diastolic: '30' })
      await userEvent.click(saveButton())
      await userEvent.clear(field.systolic())

      expect(field.systolic()).not.toHaveAttribute('aria-invalid')
      expect(
        screen.queryByText(/Systolic must be between/),
      ).not.toBeInTheDocument()
      expect(field.diastolic()).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('server errors', () => {
    it('shows a field error returned by the API (400 rest_invalid_param)', async () => {
      mockApi({
        'POST /readings': {
          status: 400,
          data: {
            code: 'rest_invalid_param',
            message: 'Invalid parameter(s): systolic',
            data: {
              status: 400,
              params: {
                systolic:
                  'systolic must be between 60 (inclusive) and 250 (inclusive)',
              },
            },
          },
        },
      })
      renderWithProviders(<NewReading />)

      await fill({ systolic: '118', diastolic: '76' })
      await userEvent.click(saveButton())

      await waitFor(() => {
        expect(field.systolic()).toHaveAttribute('aria-invalid', 'true')
      })
      expect(field.systolic()).toHaveAccessibleDescription(
        /systolic must be between 60 \(inclusive\)/,
      )
      expect(field.systolic()).toHaveValue('118')
    })

    it.each<[string, MockReply]>([
      ['a network error', 'network-error'],
      ['a server error', restError('internal', 'Boom.', 500)],
    ])(
      'keeps the values and shows an alert after %s',
      async (_label, reply) => {
        mockApi({ 'POST /readings': reply })
        renderWithProviders(<NewReading />)

        await fill({ systolic: '118', diastolic: '76' })
        await userEvent.click(saveButton())

        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Could not save the reading.',
        )
        expect(field.systolic()).toHaveValue('118')
        expect(field.diastolic()).toHaveValue('76')
      },
    )
  })
})
