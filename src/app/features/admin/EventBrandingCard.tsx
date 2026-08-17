import { useRef, useState } from 'react'

import {
  BRANDING_BACKGROUND_MAX_BYTES,
  BRANDING_CONTENT_TYPES,
  BRANDING_LOGO_MAX_BYTES,
} from '../../../application/services/event-branding'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '../../../components/ui/card'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { SectionHeading } from '../../../components/ui/section-heading'
import { StatusLive } from '../../../components/ui/status-live'

interface EventBrandingCardProps {
  readonly slug: string
  readonly logoUrl: string | null
  readonly logoWidth: number | null
  readonly logoHeight: number | null
  readonly backgroundUrl: string | null
  readonly backgroundWidth: number | null
  readonly backgroundHeight: number | null
  readonly onChanged: () => void | Promise<void>
}

type BrandingKind = 'logo' | 'background'

const ACCEPT = `${BRANDING_CONTENT_TYPES.join(',')},.png,.jpg,.jpeg`

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}

export default function EventBrandingCard(props: EventBrandingCardProps) {
  const logoInput = useRef<HTMLInputElement | null>(null)
  const backgroundInput = useRef<HTMLInputElement | null>(null)
  const [pending, setPending] = useState<BrandingKind | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const upload = async (kind: BrandingKind, file: File): Promise<void> => {
    setError('')
    setMessage('')
    if (!BRANDING_CONTENT_TYPES.some((allowed) => allowed === file.type)) {
      setError('Use a PNG or JPEG image.')
      return
    }
    const maxBytes = kind === 'logo' ? BRANDING_LOGO_MAX_BYTES : BRANDING_BACKGROUND_MAX_BYTES
    if (file.size === 0 || file.size > maxBytes) {
      setError(
        file.size === 0
          ? 'The selected image is empty.'
          : `The ${kind} must be ${megabytes(maxBytes)} MB or smaller.`,
      )
      return
    }
    setPending(kind)
    try {
      const response = await fetch(`/api/admin/events/${props.slug}/branding/${kind}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': file.type },
        body: file,
      })
      if (!response.ok) throw new Error('upload failed')
      await props.onChanged()
      setMessage(`${kind === 'logo' ? 'Logo' : 'Background'} uploaded.`)
    } catch {
      setError(`The ${kind} could not be uploaded. Check its dimensions and try again.`)
    } finally {
      setPending(null)
    }
  }

  const remove = async (kind: BrandingKind): Promise<void> => {
    if (!window.confirm(`Remove the event ${kind}? Public pages will use the default artwork.`)) {
      return
    }
    setError('')
    setMessage('')
    setPending(kind)
    try {
      const response = await fetch(`/api/admin/events/${props.slug}/branding/${kind}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) throw new Error('remove failed')
      await props.onChanged()
      setMessage(`${kind === 'logo' ? 'Logo' : 'Background'} removed.`)
    } catch {
      setError(`The ${kind} could not be removed.`)
    } finally {
      setPending(null)
    }
  }

  return (
    <Card data-tour="event-branding">
      <CardHeader>
        <SectionHeading>Event artwork</SectionHeading>
        <CardDescription>
          Optional artwork for public event pages. Text and navigation remain complete without it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <div className="grid min-h-32 place-items-center overflow-hidden rounded-lg border border-border bg-muted/40 p-4">
            {props.logoUrl === null ? (
              <p className="text-sm text-muted-foreground">Using the default logo treatment.</p>
            ) : (
              <img
                src={props.logoUrl}
                width={props.logoWidth ?? undefined}
                height={props.logoHeight ?? undefined}
                alt="Current event logo"
                className="max-h-24 max-w-full object-contain"
              />
            )}
          </div>
          <Field>
            <FieldLabel htmlFor="event-logo">Event logo</FieldLabel>
            <Input
              ref={logoInput}
              id="event-logo"
              type="file"
              accept={ACCEPT}
              onChange={() => {
                const file = logoInput.current?.files?.[0]
                if (logoInput.current !== null) logoInput.current.value = ''
                if (file !== undefined) void upload('logo', file)
              }}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            PNG or JPEG, 64–2048 pixels per side, {megabytes(BRANDING_LOGO_MAX_BYTES)} MB max.
          </p>
          {props.logoUrl !== null ? (
            <Button
              type="button"
              variant="outline"
              pending={pending === 'logo'}
              onClick={() => void remove('logo')}
            >
              Remove logo
            </Button>
          ) : null}
        </div>

        <div className="grid content-start gap-3">
          <div className="grid min-h-32 place-items-center overflow-hidden rounded-lg border border-border bg-muted/40">
            {props.backgroundUrl === null ? (
              <p className="p-4 text-sm text-muted-foreground">Using the default stage artwork.</p>
            ) : (
              <img
                src={props.backgroundUrl}
                width={props.backgroundWidth ?? undefined}
                height={props.backgroundHeight ?? undefined}
                alt="Current event background"
                className="h-32 w-full object-cover"
              />
            )}
          </div>
          <Field>
            <FieldLabel htmlFor="event-background">Event background</FieldLabel>
            <Input
              ref={backgroundInput}
              id="event-background"
              type="file"
              accept={ACCEPT}
              onChange={() => {
                const file = backgroundInput.current?.files?.[0]
                if (backgroundInput.current !== null) backgroundInput.current.value = ''
                if (file !== undefined) void upload('background', file)
              }}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            PNG or JPEG, 800×400 to 6000×4000, {megabytes(BRANDING_BACKGROUND_MAX_BYTES)} MB max.
          </p>
          {props.backgroundUrl !== null ? (
            <Button
              type="button"
              variant="outline"
              pending={pending === 'background'}
              onClick={() => void remove('background')}
            >
              Remove background
            </Button>
          ) : null}
        </div>

        <StatusLive>{message}</StatusLive>
        {error === '' ? null : <AlertLive>{error}</AlertLive>}
      </CardContent>
    </Card>
  )
}
