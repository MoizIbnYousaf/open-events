import { useEffect } from 'react'

import StartForm from './StartForm'
import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../lib/default-event'
import { requestTourToggle } from '../tour/tour-events'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardDescription, CardHeader } from '../../../components/ui/card'
import { PageHeaderTitle } from '../../../components/ui/page-header'

type AccessRecovery = 'cfp' | 'portal' | 'evaluation' | 'legacy' | 'invalid'

function accessRecovery(): AccessRecovery | null {
  const value = new URL(window.location.href).searchParams.get('access')
  return value === 'cfp' ||
    value === 'portal' ||
    value === 'evaluation' ||
    value === 'legacy' ||
    value === 'invalid'
    ? value
    : null
}

/**
 * The seeded DemoConf 2026 pair used to be copy-pasted here, which let this
 * screen drift away from the slug every other surface links to. It now reads
 * the one shared constant, so the sign-in step and the call for papers it
 * belongs to can never point at different events.
 *
 * Single-purpose page, so the column is narrower than the public measure: one
 * field and one button read better in a short line than stretched across the
 * full reading width.
 */
export function PublicStartPage() {
  const recovery = accessRecovery()
  // The tab kept whatever title the previous route had left there, so a
  // speaker with several tabs open could not tell which one held the sign-in
  // step (WCAG 2.4.2).
  useEffect(() => {
    document.title = 'Start — Open Events'
  }, [])

  if (recovery === 'evaluation' || recovery === 'portal') {
    return (
      <div className="mx-auto w-full max-w-md">
        <Card className="py-4">
          <CardHeader>
            <PageHeaderTitle>
              {recovery === 'evaluation' ? 'Reviewer link expired' : 'Speaker portal link expired'}
            </PageHeaderTitle>
            <CardDescription>
              {recovery === 'evaluation'
                ? 'Ask the event organizer to issue a fresh reviewer invitation. Proposal links do not open the review queue.'
                : 'Ask the event organizer to issue a fresh speaker portal invitation. The public proposal form cannot restore portal access.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const recoveryCopy =
    recovery === 'cfp'
      ? 'That proposal link is expired or already used. Request a fresh proposal link below.'
      : recovery === 'legacy'
        ? 'That older link no longer identifies its role. Speakers can request a proposal link below; reviewers must ask the event organizer for a fresh invitation.'
        : recovery === 'invalid'
          ? 'That link is invalid. Speakers can request a proposal link below; reviewers must ask the event organizer for a fresh invitation.'
          : null

  return (
    <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)]">
      <section className="relative grid min-h-[34rem] content-end overflow-hidden p-6 text-white sm:p-10">
        <img
          src="/images/open-events-hero-v2.png"
          alt="Codex, Claude Code, and Grok connected in a three-dimensional agent network"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
        <div className="relative grid gap-7">
          <div className="grid gap-3">
            <p className="text-xs font-semibold tracking-[0.16em] text-blue-300 uppercase">
              Private, role-based access
            </p>
            <h1 className="max-w-xl text-balance font-heading text-4xl leading-[1.02] font-semibold tracking-[-0.05em] text-white sm:text-5xl">
              Pick up exactly where you left off.
            </h1>
            <p className="max-w-lg text-base leading-7 text-white/70">
              Each access link opens only the workspace and event work assigned to you.
            </p>
          </div>

          <div className="divide-y divide-white/20 border-y border-white/20">
            <a
              href="/admin"
              className="group flex items-center gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-blue-300 text-sm font-semibold text-blue-300">
                O
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">Organizer</span>
                <span className="block text-sm text-white/65">Protected organizer sign-in</span>
              </span>
              <span
                aria-hidden="true"
                className="text-lg text-blue-300 transition-transform group-hover:translate-x-1"
              >
                →
              </span>
            </a>
            <a
              href="#speaker-access"
              className="group flex items-center gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-blue-300 text-sm font-semibold text-blue-300">
                S
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">Speaker</span>
                <span className="block text-sm text-white/65">
                  Email link for proposals and onboarding
                </span>
              </span>
              <span
                aria-hidden="true"
                className="text-lg text-blue-300 transition-transform group-hover:translate-x-1"
              >
                →
              </span>
            </a>
            <div className="flex items-center gap-4 py-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-blue-300 text-sm font-semibold text-blue-300">
                R
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">Reviewer</span>
                <span className="block text-sm text-white/65">
                  Use the private invitation sent by the organizer
                </span>
              </span>
            </div>
          </div>

          <Button
            variant="ghost"
            className="w-fit px-0 text-blue-300 hover:bg-transparent hover:text-white"
            onClick={requestTourToggle}
          >
            Explore the tour without signing in
          </Button>
        </div>
      </section>

      <section id="speaker-access" className="grid content-center px-6 py-12 sm:px-10 lg:px-12">
        <div className="grid gap-5">
          {recoveryCopy === null ? null : <AlertLive>{recoveryCopy}</AlertLive>}
          <StartForm embedded eventSlug={DEFAULT_EVENT_SLUG} formSlug={DEFAULT_FORM_SLUG} />
          <div className="border-t border-border pt-4 text-sm text-muted-foreground">
            <p>
              Organizer?{' '}
              <a className="font-medium text-link underline underline-offset-4" href="/admin">
                Use protected sign-in
              </a>
            </p>
            <p className="mt-2">Reviewer? Open the private invitation from your organizer.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
