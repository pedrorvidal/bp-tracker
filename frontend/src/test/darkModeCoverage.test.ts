import { describe, expect, it } from 'vitest'

/**
 * Guard for dark mode: a light surface, text or border color without a dark:
 * counterpart renders unreadable (e.g. slate-900 text on the slate-950 page)
 * and no functional test notices. Scans every component's class strings.
 */
const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const RULES: Array<{ light: RegExp; dark: RegExp; what: string }> = [
  {
    light: /(^|\s)(bg-white|bg-slate-50)(\s|$)/,
    dark: /(^|\s)(\w+:)*dark:bg-/,
    what: 'background',
  },
  {
    light: /(^|\s)text-slate-(500|600|700|800|900)(\s|$)/,
    dark: /(^|\s)(\w+:)*dark:text-/,
    what: 'text',
  },
  {
    light: /(^|\s)border-slate-(200|300|400)(\s|$)/,
    dark: /(^|\s)(\w+:)*dark:(border|ring)-/,
    what: 'border',
  },
]

/** Class strings: className="..." attributes and '...'/`...` class constants. */
function classStrings(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/className="([^"]*)"/g))
    found.push(match[1] ?? '')
  // Single-line only, so JSX text with apostrophes isn't taken for a class.
  for (const match of source.matchAll(
    /['`]([^'`\n<>{}]*\b(?:bg|text|border)-[^'`\n<>{}]*)['`]/g,
  )) {
    found.push(match[1] ?? '')
  }
  return found
}

describe('dark mode coverage', () => {
  it('scans the components', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
  })

  it.each(Object.entries(sources))(
    '%s pairs every light color with a dark: one',
    (_file, source) => {
      const missing = classStrings(source).flatMap((classes) =>
        RULES.filter(
          (rule) => rule.light.test(classes) && !rule.dark.test(classes),
        ).map((rule) => `${rule.what}: "${classes}"`),
      )
      expect(missing).toEqual([])
    },
  )
})
