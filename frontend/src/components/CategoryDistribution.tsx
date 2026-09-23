import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type BpCategory,
} from '../lib/bpCategory'
import CategoryBadge from './CategoryBadge'

interface CategoryDistributionProps {
  counts: Record<BpCategory, number>
}

/**
 * How the period's readings split across the ACC/AHA categories: a
 * proportional bar (decorative) and pills with the counts (the actual
 * information, so nothing depends on color).
 */
export default function CategoryDistribution({
  counts,
}: CategoryDistributionProps) {
  const total = CATEGORY_ORDER.reduce((sum, c) => sum + counts[c], 0)
  const present = CATEGORY_ORDER.filter((c) => counts[c] > 0)

  if (total === 0) {
    return null
  }

  return (
    <div className="mt-4">
      <div
        aria-hidden="true"
        className="flex h-2 gap-0.5 overflow-hidden rounded-full"
      >
        {present.map((category) => (
          <span
            key={category}
            className="h-full"
            style={{
              width: `${(counts[category] / total) * 100}%`,
              backgroundColor: CATEGORY_COLORS[category],
            }}
          />
        ))}
      </div>
      <ul
        aria-label="Readings by category"
        className="mt-3 flex flex-wrap gap-1.5"
      >
        {present.map((category) => (
          <li
            key={category}
            aria-label={`${counts[category]} ${CATEGORY_LABELS[category]}`}
          >
            <CategoryBadge category={category} count={counts[category]} />
          </li>
        ))}
      </ul>
    </div>
  )
}
