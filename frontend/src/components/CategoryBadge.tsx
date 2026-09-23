import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type BpCategory,
} from '../lib/bpCategory'

interface CategoryBadgeProps {
  category: BpCategory
  /** Optional count shown before the name, e.g. "18 Normal". */
  count?: number
}

/** A category name with its status color as a small dot (never color alone). */
export default function CategoryBadge({ category, count }: CategoryBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: CATEGORY_COLORS[category] }}
      />
      {count !== undefined && (
        <span className="font-semibold tabular-nums">{count}</span>
      )}
      {CATEGORY_LABELS[category]}
    </span>
  )
}
