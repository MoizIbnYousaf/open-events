import type { UtcInstant } from '../../domain'

/** Injectable clock so time-dependent services are deterministic in tests. */
export interface Clock {
  now(): UtcInstant
}
