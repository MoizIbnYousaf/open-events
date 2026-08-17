# Judge guide

## Premise

Open Events runs the programme between a call for papers and a public schedule:
Collect → Review → Onboard → Schedule → Publish. The product is one React and
Hono application on Cloudflare Workers, with D1 for durable state and R2 for
private files.

## Public entry

- Production: <https://www.openevents.engineer/>
- Programme: <https://www.openevents.engineer/schedule/demo-conf-2026>
- Sessions: <https://www.openevents.engineer/sessions/demo-conf-2026>
- Speakers: <https://www.openevents.engineer/speakers/demo-conf-2026>
- Call for papers: <https://www.openevents.engineer/cfp/demo-conf-2026/cfp>
- Isolated judge sandbox: <https://open-events-acceptance.speakerops.workers.dev/>

Production is the stable read-only showcase. Mutating evaluation happens only
on the isolated acceptance Worker, D1, and R2 tuple. The acceptance site is
excluded from indexing and can be reset to the documented showcase state.

## Role entry

| Role      | Entry               | Expected method                                                           |
| --------- | ------------------- | ------------------------------------------------------------------------- |
| Organizer | `/admin`            | Time-boxed organizer token supplied through the private judging channel   |
| Speaker   | `/start`            | CFP email link, then automatic portal handoff after submission            |
| Reviewer  | `/evaluations`      | Recipient-specific link issued by an organizer after committee assignment |
| Attendee  | public routes above | No account; star sessions locally and export My schedule                  |

No bearer link, organizer secret, inbox credential, provider key, or private
email is stored in this repository. If a role link expires, use the role's entry
page and the private contact path supplied with the judging credentials. Start
requests deliberately return the same answer for every address: check spam,
wait two minutes, then retry.

## Five-minute walkthrough

1. Start the guided tour from the landing page. Its six chapters cover all 26
   moments from public entry through organizer operations, speaker readiness,
   review, programme discovery, and itinerary export. Pause and resume keeps
   the exact checkpoint; temporary role access is read-only and closes on exit.
2. In an attendee context, open the programme, switch schedule views, star one
   session, and export My schedule. Open the speaker gallery and a detail page.
3. In a speaker context on acceptance, submit a proposal once. Observe the
   focused confirmation and continue to the portal. Complete profile/task work.
4. In the organizer context, filter the submissions desk, export the displayed
   queue, inspect the proposal, assign review, record a decision, and open the
   blocker-first Readiness desk.
5. In a reviewer context, score the assigned proposal or record a conflict so
   the organizer can reassign it.
6. Back as organizer, resolve the seeded agenda conflict, publish, and inspect
   message intent/delivery wording. Then return to the public programme.

The complete context-by-context script is in [demo-script.md](demo-script.md).

## Recovery and truth boundaries

- A captured message means the application recorded an intent, not that a
  provider or inbox received it.
- Provider acceptance, signed provider outcome, inbox receipt, and successful
  redemption are separate receipts.
- Uploads stay private. Public speaker imagery is currently initials-only; no
  uploaded image is automatically promoted into the gallery.
- Acceptance is the only destructive test target. Production is read-only
  during judging.

## Known limitations

Public distribution is intentionally narrow: agenda, gallery, and itinerary
HTML widgets; sessions and speakers JSON; and full-schedule iCalendar. XML and
arbitrary kind/format combinations are unsupported. Uploaded speaker imagery
stays private until a future checksum-bound human-review workflow exists.
Official submission status is reported only by a retained acknowledgement from
the competition channel.
