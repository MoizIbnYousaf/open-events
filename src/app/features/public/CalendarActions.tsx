import type { CalendarEventDetails } from '../../../domain/calendar-links'
import { buildGoogleCalendarUrl, buildOutlookCalendarUrl } from '../../../domain/calendar-links'
import { TextLink } from '../../../components/ui/link'

export default function CalendarActions({
  event,
  icsHref,
}: {
  readonly event: CalendarEventDetails
  readonly icsHref: string
}) {
  return (
    <div
      role="group"
      aria-label={`Add ${event.title} to calendar`}
      className="flex flex-wrap gap-2"
    >
      <TextLink
        hit
        className="min-h-9 rounded-md border border-border px-3 text-sm no-underline hover:bg-muted hover:no-underline"
        href={buildGoogleCalendarUrl(event)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Add to Google Calendar
      </TextLink>
      <TextLink
        hit
        className="min-h-9 rounded-md border border-border px-3 text-sm no-underline hover:bg-muted hover:no-underline"
        href={buildOutlookCalendarUrl(event)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Add to Outlook
      </TextLink>
      <TextLink
        hit
        className="min-h-9 rounded-md border border-border px-3 text-sm no-underline hover:bg-muted hover:no-underline"
        href={icsHref}
        download
      >
        Download iCalendar file
      </TextLink>
    </div>
  )
}
