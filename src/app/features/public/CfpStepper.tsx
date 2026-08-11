import type { FormPageDto } from '../../../application'
import { cn } from '../../../lib/utils'
import { CheckIcon } from '../../../components/ui/icons'

interface CfpStepperProps {
  readonly steps: readonly FormPageDto[]
  readonly currentIndex: number
}

/**
 * The speaker's map of the form.
 *
 * It stays an `<ol>` with one `<li>` per page, because the thing being drawn
 * genuinely is an ordered list and a screen reader should hear "3 of 4"
 * without any of the chrome below. The chrome is what changes: a numbered
 * marker per step, a rule joining them so the row reads as one path rather
 * than four separate chips, the current step filled, and a check where the
 * speaker has already been.
 *
 * The marker is `aria-hidden` and each `<li>` keeps its `aria-label`, so the
 * accessible name is the step title alone — the number is redundant with the
 * list position that the list element already conveys, and reading it out
 * would say the same thing twice.
 *
 * It draws the map and nothing else. Back and Next used to live here, above
 * the content card, while Save sat below it — one step's controls bracketing
 * the content from two different places. They now share the single action bar
 * under the card.
 */
export default function CfpStepper({ steps, currentIndex }: CfpStepperProps) {
  return (
    <nav aria-label="Form steps">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
        {steps.map((step, index) => {
          const done = index < currentIndex
          const current = index === currentIndex
          return (
            <li
              key={step.id}
              aria-label={step.title}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex min-w-0 items-center gap-1.5',
                current ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {/* The connector belongs to the step it leads into, so the row
                  never opens or closes on a dangling rule — but that only holds
                  while the row IS a row. Below `md` the titles wrap onto two or
                  three lines and every line after the first opened with a rule
                  pointing at the left margin, so the connectors are drawn only
                  at the widths where the path is genuinely horizontal. */}
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  data-slot="step-connector"
                  className="mr-1 hidden h-px w-4 shrink-0 bg-border md:block"
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full text-[11px] leading-none font-medium tabular-nums',
                  current
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border text-muted-foreground',
                )}
              >
                {done ? <CheckIcon size={12} /> : index + 1}
              </span>
              <span className="min-w-0">{step.title}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
