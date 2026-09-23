import { cloneElement, isValidElement, type ReactNode } from 'react'

/**
 * jsdom has no layout, so recharts' ResponsiveContainer measures 0×0 and
 * draws nothing. Tests swap it for this: the chart gets a fixed size and
 * renders real SVG (zones, lines, dots, brush) that tests can assert on.
 *
 * Usage (at the top of a test file; vi.mock is hoisted, so import inside):
 *   vi.mock('recharts', async (importOriginal) => ({
 *     ...(await importOriginal<typeof import('recharts')>()),
 *     ResponsiveContainer: (await import('../test/rechartsFixedSize'))
 *       .FixedSizeContainer,
 *   }))
 */
export function FixedSizeContainer({ children }: { children?: ReactNode }) {
  return (
    <div style={{ width: 800, height: 300 }}>
      {isValidElement<{ width?: number; height?: number }>(children)
        ? cloneElement(children, { width: 800, height: 300 })
        : children}
    </div>
  )
}
