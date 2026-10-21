# Finishing Open Events

Working notes from a complete top-to-bottom review of the 37-page competition
brief, including its text, screenshots, red annotations, and the intent those
choices imply. Current product comparison is against the deployed Open Events
release on canonical `main` commit
`bf9d14b55ace66cf741c312dd6049d52e0187acd`.

## Executive read

The competition is not asking for a broad Sessionboard clone. It is asking for
the smallest credible product that eliminates the organizer's recurring
operational pain and makes the $40,000 annual subscription feel unnecessary.

The winning shape is an end-to-end programme operations loop:

1. An organizer configures an event and publishes a custom CFP.
2. A speaker submits and lands reliably in a self-service portal.
3. A committee evaluates proposals and the organizer makes decisions.
4. Accepted speakers receive communications and complete their own onboarding.
5. The organizer sees what is outstanding, resolves schedule conflicts, and
   publishes the programme.
6. Attendees can browse and save the resulting schedule.

Open Events already implements almost all of this loop and, in several areas,
goes beyond the brief. The main risk is no longer feature quantity. The main
risk is whether an independent judge can experience the full loop on the live
deployment without Moiz standing beside them, supplying secrets, or explaining
why an email never arrived.

That makes demo access, real delivery, populated proof, and a crisp submission
package more important than another feature sprint.

## The source must be read with formatting intact

The copied text alone is misleading because it loses strikethrough. In the
rendered first page:

- The base requirement for submission evaluation and scoring remains active,
  but the phrase about optional AI-assisted review across multiple rounds is
  struck out.
- The Accelevents integration bullet is struck out.
- The portal resource/wiki and HTML embed bullet is struck out.
- The embeddable, mobile-friendly speaker gallery and schedule itinerary bullet
  remains active; the strike-through ends with the preceding portal-resource
  bullet.

The active high-level core is therefore:

- custom CFP forms with conditional logic and category routing;
- a self-service speaker portal for profile and files;
- templated communications, reminders, and calendar invites;
- submission evaluation and scoring;
- drag-and-drop agenda building with conflict detection and multiple views;
- real-time visibility into incomplete speaker onboarding; and
- an embeddable, mobile-friendly speaker gallery and schedule itinerary.

Some struck or optional capabilities reappear later as visual references. I
read those as useful context or bonus scope, not permission to displace the
active core jobs.

## What the organizers are actually optimizing for

### 1. Eliminate coordination labour

The repeated pattern is not “store event records.” It is “stop the organizer
from chasing people and re-entering information.” The portal, reminders,
confirmation email, tasks, file requests, status queues, agenda conflicts, and
readiness dashboard are all mechanisms for reducing follow-up work.

### 2. Make the next action obvious

The screenshots repeatedly show lists, counts, queues, status chips, tabs,
filters, and direct create/add controls. The dashboard is not primarily a
reporting exercise; it answers operational questions:

- Which submissions still need a decision?
- Which reviewers still owe scores?
- Which accepted speakers are missing a bio, headshot, file, or confirmation?
- Which accepted sessions still need a time slot?
- Where are the scheduling conflicts?

### 3. Prefer a reliable handoff over a feature-rich dead end

The red annotations are unusually revealing:

- post-submit redirect to the speaker portal: “make sure this works”;
- submission confirmation: “must have”;
- admin notifications: “nice to have”;
- close date: “kinda impt”;
- payments and fees: “NOT NEEDED.”

This is a product-quality hierarchy. A modest flow that closes every handoff is
more valuable than a larger system with an ambiguous success state.

### 4. Judge the product, not the implementation theatre

The AIE team will evaluate independently. The tiebreaker is explicitly the
quality of subjective product decisions—whether this is something the
organizers would actually use or buy. That means the app must explain itself,
have credible data, recover cleanly, and make tradeoffs visible without a live
narrator.

### 5. Speed is part of trust

“We do not want slow SaaS” is not decorative bonus language. An operations tool
gets opened repeatedly during deadline and event-day pressure. Fast navigation,
quick lists, immediate saves, and stable loading states communicate that the
open-source replacement is viable rather than merely cheaper.

## Visual review: all 39 pages

### Pages 1–4 — brief, source map, rules, and scoring signals

- Page 1 establishes the emotional premise: real frustration with a product
  costing more than $40k annually despite partial usage. The screenshot of the
  Sessionboard product map contrasts its breadth with the brief's deliberately
  crossed-out scope.
- Page 2 says the walkthrough and screenshots are requirements evidence. The
  highlighted documentation map concentrates attention on programme/agenda,
  submissions/forms, portals, evaluations, and communications. Reporting/AI is
  explicitly lower priority.
- Page 3 lists the participant and organizer points of view and names the public
  outputs: sessions, speakers, agenda, itinerary, and gallery.
- Page 4 makes a deployed, testable site and open-source repository part of the
  submission. Cloudflare, speed, and API support earn bonus value. Airtable and
  Forge are workflow-affinity bonuses, not core product requirements.

### Pages 5–7 — event configuration

- The settings overview groups event details, record settings, portals,
  submission forms, taxonomy-like fields/tags/personas, email templates/themes,
  and integrations.
- Event details include name, slug, type, website, location, timezone, dates,
  and theme copy.
- Brand imagery and exhibitor/sponsor toggles appear, but they are not the
  centre of the requested programme workflow.

Intent: event configuration should be shallow and legible. The organizer needs
enough structure to drive forms, deadlines, communications, and publication;
they should not need to configure an entire event ERP before opening a CFP.

### Pages 8–16 — submission form creation

- The forms index makes creation discoverable and shows open/closed form state,
  submission counts, drafts, and closing dates.
- Form setup distinguishes abstract and session collection and can include
  participant information.
- A welcome screen supports an external title, heading, and rich explanatory
  content.
- Abstract information combines editable section copy with locked/core and
  configurable fields such as title, description, format, tags, track, and
  level.
- Participant information supports roles, multiplicity, core identity fields,
  biography, and other contact data.
- Payments are explicitly excluded.
- Form settings include post-submit redirect, success copy, validation rules,
  closing date, limits, and draft behavior.
- The organizer's strongest annotations require the redirect into the portal
  and the submitter confirmation. Admin notifications are secondary.

Intent: the builder is not judged as a generic no-code canvas. It is judged by
whether an organizer can publish a realistic CFP and whether the resulting
speaker journey preserves context through submission and into onboarding.

### Page 17 — public CFP

The public screen is a staged, deadline-aware wizard with event context,
helpful links, application guidance, and progress across welcome, account,
submission, participant, and review steps.

Intent: the form should feel like an application process, not an anonymous
database form. Speakers need confidence about deadlines, limits, what happens
after submission, and where they can return.

### Pages 18–19 — speaker portal and profile

- The portal home brings submissions, profile, and tasks together.
- Submissions expose accepted/pending state.
- The profile is self-service and includes biography, identity, and public
  links.
- The organizer's annotation emphasizes that speakers update their own bio
  data.

Intent: every field a speaker can safely maintain is one less organizer email
and one less stale spreadsheet cell.

### Pages 20–23 — abstract operations

- The abstract list uses status queues and dense columns.
- Status changes include accepted, accept queue, pending, decline queue,
  declined, and a negative-pending state.
- A column preferences panel exposes many event-specific fields and lets the
  organizer shape the desk around the decision being made.
- Import, CSV/XLSX export, files bundle download, manual abstract creation, and
  search/filter/sort controls are visible.

Intent: this is a high-volume work queue. Once the golden lifecycle is solid,
the most valuable depth is not another detail card—it is faster triage across
many proposals.

### Page 24 — agenda

The agenda surface exposes List, Day, Week, Month, Rooms, and Conflicts views,
plus search, saved view, columns, sort, filters, draft state, and add-session.

Intent: scheduling is a multi-dimensional constraint problem. The product must
let an organizer move between temporal, room, track, and conflict-oriented
views without losing the underlying programme state.

### Pages 25–31 — tasks, forms, confirmations, and files

- Tasks can be created or copied and targeted to contacts or sessions.
- Portal forms can target contacts, groups, or submissions.
- Form questions can reuse known fields or create new fields.
- Form settings can send a confirmation email containing a link back to the
  submission.
- File requests are first-class assignments with title, target type, and rich
  instructions; uploaded files remain centrally available for export.

Intent: “speaker portal” means configurable post-acceptance work, not a static
profile page. Tasks, forms, and file requests are separate organizer concepts
but should appear to the speaker as one coherent checklist.

### Pages 32–33 — embeds, explicitly optional

The embed builder can publish styled HTML for agenda/session/speaker content,
preview it, filter it, adjust fields and style, and copy code.

Intent: distribution matters, but it is optional. A clean API/feed/embed is
valuable only after the core programme data is correct and the live demo is
accessible.

### Pages 34–39 — operational dashboards, explicitly best effort

- The “Today” dashboard summarizes submissions, accepted speakers, status
  counts, warnings, forms, and recent submissions.
- Review progress shows evaluation totals and outstanding reviewer activity.
- Participant tracking calls out missing bios/headshots and readiness.
- Speaker tracking focuses on confirmations, incomplete tasks, and overdue
  accepted speakers.
- Submission pipeline visualizes received, reviewed, accepted, form, and track
  breakdowns.
- A dashboard gallery offers presets for event overview, submissions pipeline,
  speaker tracking, review progress, evaluation by track, and schedule health.

Intent: a dashboard is valuable when each number leads to work. Static charts
that merely restate table counts are not the ask. The useful unit is a warning
with a direct path to the people or records that need attention.

## Open Events against the brief

| Requirement or signal                                        | Current evidence                                                                                                   | Verdict                                                                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configurable CFP with conditional logic and category routing | Versioned builder, typed fields, taxonomy choices, conditional rules, routing, preview, and publish                | Strong                                                                                                                                                                                      |
| Speaker submission and reliable post-submit handoff          | Drafts, idempotent submit, confirmation state, own-submission portal                                               | Strong locally; must prove live handoff                                                                                                                                                     |
| Self-service profile, headshot, documents, and tasks         | Profile editor, validated headshot/document upload, task checklist, travel/confirmation flows                      | Strong                                                                                                                                                                                      |
| Templated communications, reminders, and calendar invites    | Confirmation template, acceptance/reminder templates, immutable message history, stable-UID ICS                    | Functionally strong, but the critical magic-link and submission-confirmation writes bypass the provider adapter; Resend configuration alone does not make the live role journey deliverable |
| Evaluation and scoring                                       | Criteria, weighted results, rounds, reviewer pools, assignments, blind review, recusal, score entry, CSV results   | Strong; exceeds active scope without relying on AI review                                                                                                                                   |
| Agenda and conflict detection                                | Drag/drop board, assisted placement, room/track/speaker conflicts, publish flow                                    | Strong                                                                                                                                                                                      |
| List/day/week/track/room public views                        | Published schedule and session surfaces include all requested views                                                | Strong                                                                                                                                                                                      |
| Outstanding onboarding visibility                            | Readiness page polls and shows per-session complete/outstanding/ready state with links                             | Meets core job; could be more dashboard-like                                                                                                                                                |
| Public sessions, speakers, itinerary, gallery, iCal, embeds  | The mobile gallery/itinerary and their embeddable use are active; broader feed/embed combinations are overdelivery | Core surfaces exist, but populated and cross-origin embed proof remains                                                                                                                     |
| Accelevents                                                  | Not implemented                                                                                                    | Correctly deprioritized because struck out                                                                                                                                                  |
| Airtable persistence                                         | Uses Cloudflare D1/R2 instead                                                                                      | Misses a bonus, but gains a coherent single-platform deployment                                                                                                                             |
| Cloudflare deployment                                        | Worker + D1 + R2 live on custom domain                                                                             | Bonus achieved                                                                                                                                                                              |
| Speed/performance                                            | Release performance budgets pass; live app is responsive                                                           | Bonus achieved                                                                                                                                                                              |
| API                                                          | Same-origin Hono API exists, but there is no obvious judge-facing API reference/OpenAPI surface                    | Partial bonus                                                                                                                                                                               |
| Open source                                                  | Apache-2.0 GitHub repository                                                                                       | Core achieved; misses only the explicitly tiny Forge preference                                                                                                                             |

## The most important finishing gap: judges cannot yet self-demo the full loop

The public schedule, CFP, sessions, and speakers work live. The protected role
doors currently behave safely but create evaluation friction:

- the organizer path asks for a secret;
- the reviewer and speaker paths require a valid magic-link session;
- the critical magic-link and submission-confirmation paths currently write
  directly to the captured-message log, bypassing the provider adapter, so
  Resend configuration by itself would still leave the judge-critical entry
  loop undeliverable;
- the built-in tour reaches protected screens and must skip them when the judge
  is not signed in.

This directly conflicts with the competition's practical requirement that the
deployed site can be tested with the walkthrough shown. It also clashes with
the landing copy promising that people can jump in by role with “no extra
account.”

The finishing move should be a safe, documented demo-access path—not weakening
production authorization generally. Plausible options, in preference order:

1. Configure real email delivery, provide the organizer demo secret privately
   in the submission, and seed known role emails/assignments.
2. Add a tightly scoped demo-mode role launcher for the one seeded event, with
   resets or reversible fixtures and unmistakable demo labeling.
3. Provide pre-generated, time-bounded judge links plus the organizer secret in
   a concise judge README, accepting that links can expire during evaluation.

The first option proves the actual product and has the least special-case code.

## Finishing priorities

### P0 — submission viability

- [ ] Verify the actual submission deadline or extension immediately. The doc
      says Wednesday, August 12 at 10 PM PT, which has passed as of this review.
- [ ] Locate and complete the promised submission form.
- [ ] Confirm the public repository URL, license, and live URL are ready to
      share.
- [ ] Provide exact judge access instructions for organizer, speaker, and
      reviewer roles.

### P0 — live end-to-end proof

- [ ] Configure and prove real speaker/reviewer email delivery, including a
      magic link, submission confirmation, acceptance/reminder template, and ICS.
- [ ] Run the golden lifecycle against a disposable production demo event or a
      production-like isolated environment, without corrupting the canonical
      showcase event.
- [ ] Confirm post-submit success copy and automatic portal handoff on the live
      deployment—the screenshot explicitly says this must work.
- [ ] Confirm a judge can sign in, score, recuse, accept, onboard, place,
      resolve a conflict, publish, and find the result without private tooling.
- [ ] Capture proof boundaries separately: source commit, test suite, deployed
      Worker version, database migrations, delivered email, and rendered browser.

### P0 — demo data and narrative

- [ ] Populate enough proposals, reviewers, accepted speakers, incomplete
      tasks, files, tracks, rooms, and conflicts to make every key screen explain
      itself. Three published sessions and one public speaker prove rendering but
      undersell the operations product.
- [ ] Ensure every visible speaker/session fixture is complete and coherent;
      missing names or empty profiles read as unfinished rather than intentionally
      sparse.
- [ ] Keep the standing visual constraint: no shipped image may contain a
      woman.
- [ ] Make the homepage promise match access reality.

### P1 — make operations depth visible

- [ ] Upgrade the submissions desk toward the screenshot's high-volume job:
      decision filters/queues, useful column selection, sort, and export. Do this
      only where it improves an actual judging task.
- [ ] Turn readiness from a correct table into a stronger “today” surface:
      overdue/outstanding summaries with direct links to the affected proposal or
      speaker action.
- [ ] Add a small judge-facing API reference or OpenAPI document if the API
      bonus is worth pursuing; do not invent endpoints only to create a document.
- [ ] Show the existing embed/feed capability in the demo or README so the
      overdelivery earns credit.

### Explicitly do not prioritize

- AI-assisted proposal review; the clause is struck out.
- Accelevents; the requirement is struck out.
- A broad resource/wiki CMS; struck out.
- Payments and fees; explicitly marked not needed.
- Migrating persistence to Airtable solely for bonus points.
- Moving source from GitHub to Forge solely for a “very teeny” bonus.
- More AI surface area around Orby until the core role demo is independently
  accessible.
- Cosmetic imitation of Sessionboard. The brief explicitly does not require
  matching its design.

## Recommended five-minute judging walkthrough

1. **0:00–0:30 — premise and event.** Open the populated event and show that
   the product is fast, live on Cloudflare, and scoped to programme operations.
2. **0:30–1:15 — configure and publish.** Show event dates/deadline, form pages,
   conditional logic/category routing, preview, and version publication.
3. **1:15–2:00 — speaker submits.** Submit a proposal, show the confirmation,
   automatic portal handoff, and delivered email.
4. **2:00–2:45 — committee review.** Open a round, assign a reviewer, score a
   proposal, demonstrate recusal, and show weighted results.
5. **2:45–3:35 — decision and onboarding.** Accept, send the templated message,
   open the speaker portal, update bio/headshot/file, and complete tasks.
6. **3:35–4:30 — agenda.** Drag sessions into rooms, trigger a real conflict,
   resolve it, and publish.
7. **4:30–5:00 — attendee and organizer closure.** Show the public schedule by
   room/track, star a session, export ICS, then show readiness with no mystery
   work left outstanding.

This sequence mirrors the organizers' actual buying decision: can one coherent
system carry a proposal from intake to a findable public session while reducing
manual follow-up at every handoff?

## Completion standard

Open Events is ready to submit when an independent evaluator can start from the
README or competition submission, access every required role, complete the
golden lifecycle on the deployed product, receive the promised communications,
and understand the product's tradeoffs without asking Moiz for missing context.

The implementation is already broad enough. Finishing now means making the
proof undeniable.
