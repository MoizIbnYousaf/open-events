import type { FormPageDto } from '../../../application'
import { Button } from '../../../components/ui/button'

interface CfpStepperProps {
  readonly steps: readonly FormPageDto[]
  readonly currentIndex: number
  readonly onBack: () => void
  readonly onNext: () => void
}

export default function CfpStepper({ steps, currentIndex, onBack, onNext }: CfpStepperProps) {
  return (
    <nav aria-label="Form steps" className="grid gap-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-label={step.title}
            aria-current={index === currentIndex ? 'step' : undefined}
            className={index === currentIndex ? 'font-semibold' : 'text-muted-foreground'}
          >
            {step.title}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        {currentIndex > 0 ? (
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
        ) : null}
        {currentIndex < steps.length - 1 ? (
          <Button type="button" onClick={onNext}>
            Next
          </Button>
        ) : null}
      </div>
    </nav>
  )
}
