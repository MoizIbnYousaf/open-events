# Decision records

Short, dated records for choices that a later reader would otherwise be tempted
to "fix". Each one states what was decided, why, and what would have to change
for the decision to be revisited.

---

## DEC-005 — Organizer readiness refreshes by bounded polling

**Decision.** The organizer readiness table refreshes on a fixed 30-second
interval (`READINESS_POLL_INTERVAL_MS`, `src/app/queries/portal-tasks.ts`)
rather than through a socket or a server-sent stream.

**Why.** Readiness is a slow-moving aggregate: it changes when a speaker
completes a checklist item, which happens minutes apart at best. A bounded poll
needs no new transport, no connection lifecycle and no reconnection logic, and
it degrades to "slightly stale" rather than to "silently disconnected".

**Revisit if.** Readiness becomes something an organizer watches live during an
event day, or the row count grows enough that a full refetch is wasteful.

---

## DEC-011 — Transient feedback: inline live regions plus one app announcer, no toast overlay

> **Superseded in part by [DEC-018](#dec-018--three-transient-outcomes-also-get-a-toast),
> which is itself superseded by
> [DEC-019](#dec-019--sonner-replaces-the-in-house-toast-runtime).**
> Everything below still holds for the inline regions and the app announcer.
> The blanket "no toast overlay" no longer does: four named outcomes now also
> raise a visible transient card. Read DEC-019 for which ones and why.

**Decision.** Open Events does not ship a toast/snackbar system. Feedback is
delivered by (a) the inline `StatusLive` / `AlertLive` node next to the control
that caused it, and (b) one always-mounted, screen-reader-only announcer in the
root shell (`src/components/ui/live-announcer.tsx`, fed by
`src/app/lib/announcer.ts`).

**Why this is a product decision, not a dependency constraint.** Base UI's own
Toast is already vendored under the pinned `@base-ui/react`, and
`scripts/ui-check.mjs` permits it. Shipping one would cost no new dependency.
It is declined on merits:

1. **Every mutation in this product already has a durable on-page consequence.**
   Event settings reset to the server's values, taxonomy rows are re-seeded, the
   builder rebinds its draft and relabels the version list, the CFP editor cache
   updates and clears dirty, the submit screen becomes "Submission received", a
   task row flips to Complete, the stored headshot is re-read, and the
   communications panel records the acceptance and enables the send. A toast
   would be a second, auto-expiring channel duplicating state the page already
   holds — and organizer sessions are long, so a message that survives a glance
   away is worth more than one that does not.
2. **Error recovery here is action-bearing and must not auto-dismiss.** The CFP
   save bar and the builder's conflict block carry Reload latest / Discard /
   Retry buttons. Putting those inside a dismissing overlay is strictly worse.
3. **There is no queued or background work for a toast to report.** Nothing in
   this product completes off-screen.
4. **The one genuine off-screen case** — reordering a page element in the
   builder — is answered by keeping focus on the control that moved and
   announcing the new position, not by an overlay.

**What is forbidden under this decision.** Shipping a toast provider with no
real dispatch sites, purely so a scanner detects one. That is a fake component.

**Consequence for the announcement contract.** Because there is no toast
channel, the live regions have to actually work:

- Both announcer regions are rendered from first paint and never unmounted; a
  live region has to already be in the accessibility tree when its text changes.
- The announcer regions declare `aria-live`/`aria-atomic` and deliberately carry
  **no** ARIA role, so they do not become a second page-global `role="status"`
  competing with each surface's own status region.
- `aria-busy` never appears on a live region. On the region it instructs
  assistive tech to suppress the announcement; it belongs on the container being
  populated.
- Every element carrying `aria-busy` contains a human-readable status message.
- `announce()` is called only from user-initiated mutation callbacks. Query
  lifecycle — background refetch, route preload, readiness polling — stays
  silent.

**Revisit if.** The product grows genuinely asynchronous work whose result lands
while the user is on a different surface (a queued export, a bulk send).

---

## DEC-012 — Navigation, not a command palette

> **Superseded by [DEC-017](#dec-017--a-command-palette-on-top-of-the-navigation).**
> The condition this decision named — "a visible navigation already exists for
> it to accelerate" — was not true when it was written and is true now. The
> rest of the reasoning survives unchanged: the palette renders from the same
> `nav-model.ts` list, and it is an accelerator, never the only way in.

**Decision.** Reachability is solved with ordinary, visible navigation: an event
nav on every organizer screen, a Speaker and a Programme nav on the public
shell, an organizer sign-in link in the site header, and a Public links card on
event settings. No ⌘K command palette.

**Why.** A palette earns its place when destinations are numerous, users are
expert repeat users, and a visible navigation already exists for it to
accelerate. None of the three holds here: there are about a dozen destinations
in total, an organizer touches them a handful of times per event, and before
this change there was no navigation at all — six routes had zero inbound links
and were reachable only by typing a URL. Making a palette the only way in would
hide the product's entire surface area from anyone seeing it for the first time.

**Consequence.** `src/app/features/nav/nav-model.ts` is the single source of
truth for destinations. If an accelerator is ever added it must render from that
same list, which makes it structurally impossible for it to offer a command the
visible UI cannot perform.

**Revisit if.** The destination count grows past what a nav bar can hold, or
cross-event search becomes a real requirement (note that organizer routes are
event-scoped, so cross-event search is also an authorization question).

---

## DEC-013 — Input purpose is declared truthfully, including "off"

**Decision.** WCAG 2.2 SC 1.3.5 tokens are declared where a field collects the
**user's own** data. Where a field's label or name would make browser heuristics
fill the user's data into a field that is not about them, `autocomplete="off"`
is declared instead. Where neither applies, nothing is declared.

**Why "off" is a fix and not a suppression.** Left bare, Chrome and Safari
label-and-name heuristics do fire. The co-speaker rows collect a third party's
name and email, so a personal token would offer the submitter's own saved
details as a one-tap fill into someone else's row — the exact misfill the
duplicate-email guard exists to catch — and would harvest a co-speaker's address
into the submitter's autofill profile. The event identity fields (Name, Website,
Organizer contact, Venue) describe the event and are published on the public
programme, so `organization` / `url` / `email` / `street-address` would be false
declarations that leak the operator's personal details into public records.

**Where real tokens are declared.** CFP questions authored by the organizer, via
`autocompleteForElement` in `src/app/lib/autocomplete-purpose.ts`, derived from
the element's field key and shared by the live form and the builder preview so
the two cannot drift. `title` is deliberately unmapped — in this product it is
the proposal title, not an honorific.

**A standing disagreement with automated audits.** UI scanners flag the
co-speaker email input (`src/app/features/public/CfpCoSpeakers.tsx`) because it
is `type="email"` without `autocomplete="email"`, and recommend adding the
token. Do not. The rule infers "personal data" from the input type and cannot
see whose person it is. Declaring `email` there would be a factually wrong
statement of input purpose under SC 1.3.5, and it would make browsers offer the
signed-in speaker's own address as a one-tap fill into a co-speaker's row. The
points are worth less than the correctness.

**Revisit if.** Input purpose becomes a modelled property of a form element
rather than a derived one. That would change the canonical serialization behind
the published-version content hash and needs its own migration.

---

## DEC-014 — One live region per outcome

**Decision.** A single outcome is carried by exactly one live region. Where a
surface renders the outcome inline — `AlertLive` for a failure, `StatusLive` for
a success — that node is the announcement and `announce()` is not called with the
same text. `announce()` carries the outcomes a surface cannot voice itself: the
message has no inline node (`AdminLogin` "Signed in", which navigates away), or
the inline record only appears after a later refetch (`CommunicationsPanel`
"Acceptance sent").

**Why.** `AlertLive` is `role="alert" aria-live="assertive"` and `StatusLive` is
`role="status" aria-live="polite"`; both are audible. Pairing either with an
`announce()` of the same sentence is not "visual plus audible" — it is two live
regions mutating in one commit, and assistive tech speaks both. That is worse
than the behaviour before the app announcer existed, and it contradicts DEC-011's
own promise that the same text is never announced twice.

**Where a terse chip and a named sentence coexist.** `EventConfig`,
`TaxonomyEditor`, `BuilderEditor` and `CfpSaveBar` keep a short visual chip
("Saved", "Published") next to the trigger and announce an object-specific
sentence ("Event settings saved", "Version 3 published"). The two texts are
different by design: "Saved" alone is ambiguous on a screen where Save and
Publish sit side by side. Making the chip say the whole sentence is the
follow-up; it changes copy that other suites pin, so it is not folded in here.

**Known limit, now partly closed.** Several inline regions were created
together with their text rather than being a stable region whose text changes.
`role="alert"` is announced on insertion, so the failure paths were always
sound; the polite `role="status"` paths are only reliable stabilised (`cond ?
<StatusLive>x</StatusLive> : null` → `<StatusLive>{cond ? x : null}</StatusLive>`).
The in-flight regions beside a save/submit control now have that shape —
`CommunicationsPanel` (accept and send), `EventConfig`, `TaxonomyEditor`,
`BuilderEditor`, `PublishConfirmDialog`, `CfpSaveBar`, `CfpSubmit`,
`EvaluationsPage` — merged with the settled chip beside them where one exists,
so a surface exposes one status node per control rather than two. It does add
an always-present, empty status node to those surfaces, which is why the suites
that used to pin "no status at all" now pin "the region is there and says
nothing". The outcome-only regions now have it too: `HeadshotUploader` — where
"Uploading your headshot…" and "Headshot updated" are one node, and that node is
the upload's only channel, so the shape is the difference between announcing the
longest-latency flow in the app and announcing nothing — `StartForm`'s "Check
your email", and the builder preview's "No problems found in these answers.".

Still to do, and this list is the grep: `AdminLogin`'s "Signing in…" is the only
`cond ? <StatusLive>x</StatusLive> : null` left in `src`. The loading and empty
states stay as they are — they mount with the subtree they describe and have no
earlier moment to exist in.

**Revisit if.** The inline regions become non-live visual records, which would
make `announce()` the only audible channel and remove the choice entirely.

---

## DEC-015 — D is the primary theme chord; L remains an alias

**Decision.** `ThemeProvider` handles `Ctrl/Cmd+Shift+D` and retains
`Ctrl/Cmd+Shift+L` as a compatibility alias. Both are inert in editable
controls, during composition and repeats, and with Alt held. The handler calls
`preventDefault()` only on a path that changes the theme. The visible `<kbd>`
names D; `aria-keyshortcuts` and the README disclose both chords.

**Why.** D is the discoverable convention for dark mode, while L preserves
existing user muscle memory. `Ctrl/Cmd+Shift+D` overlaps browser commands
(`Bookmark all tabs` in Chromium browsers and responsive design mode in
Firefox), but those actions remain available from browser menus. We accept that
bounded collision in exchange for an app shortcut users can predict.

**Revisit if.** Browser shortcut conflicts produce support incidents, or the
app grows a shortcut registry where conflicts are declared and remapped in one
place.

---

## DEC-017 — A command palette on top of the navigation

**Decision.** Open Events ships a command menu (`src/app/features/command/`,
`src/components/ui/command.tsx`), opened by `Cmd/Ctrl+K` **and** by a visible
button in the site header. It lists every destination in
`src/app/features/nav/nav-model.ts` plus the three theme preferences.

**Why now, when DEC-012 declined it.** DEC-012 declined a palette on a stated
condition: "a palette earns its place when destinations are numerous, users are
expert repeat users, and a visible navigation already exists for it to
accelerate… before this change there was no navigation at all". That last
clause is no longer true — the event nav, the speaker/programme navs and the
site header link now exist. A palette on top of a visible navigation
accelerates it; a palette instead of one hides the product. Only the second
kind was ever declined.

**What keeps it honest.**

- **One source of truth.** The palette renders from `nav-model.ts`. It cannot
  offer a destination the visible navigation does not have, and it cannot offer
  a route that is deliberately unlinked — `/evaluations` has no server behind it
  in this candidate (DEC-016), so it is absent from the nav model and therefore
  absent from the palette.
- **No invented entries.** The builder and the submission detail are not in it:
  both need an id that only the list that owns them has, and an entry that
  guesses one would be a dead control.
- **Keyboard first, and it gives the keyboard back.** The ARIA
  combobox-and-listbox pattern: focus stays in the search box, arrow keys move
  `aria-activedescendant`, Enter activates, Escape closes and focus returns to
  the visible button. `Cmd/Ctrl+K` is ignored while focus is in a text control,
  because `Ctrl+K` deletes to the end of the line in macOS text fields — with
  one exception, closing the palette, whose own search box is by definition a
  text control.
- **No new dependency.** Built on Base UI's Dialog, which already owns the
  focus trap, the Escape handling and the focus restore. `cmdk` would have been
  a second overlay runtime for a list and a filter. The composition also imports
  no icon set, because it ships in the entry chunk that `scripts/perf-check.mjs`
  budgets.

**Revisit if.** Destinations become event-scoped across several events, which
turns palette search into an authorization question, or the list grows past
what one unsectioned dialog can present.

---

## DEC-018 — Three transient outcomes also get a toast

> **Superseded by [DEC-019](#dec-019--sonner-replaces-the-in-house-toast-runtime).**
> Which outcomes get a toast, and why a toast is never the only report, are
> unchanged and still argued here. What changed is the implementation — the
> in-house runtime is gone — and the headshot upload, which this entry
> excluded and DEC-019 admits on different grounds.

**Decision.** `src/components/ui/toast.tsx` is a small in-house toast, mounted
once in the root shell. Three outcomes are routed through it: the acceptance
message sent, a form version published, and a speaker task completed. Nothing
else. Publishing a session belongs on the same list; the agenda surfaces are
owned by another workstream in this candidate and are not touched here, so that
fourth call site lands with them.

**Why these three and not the rest.** DEC-011 declined a toast on the grounds
that every mutation here leaves a durable on-page consequence, so an
auto-expiring second channel would duplicate state the page already holds. That
is still true of saving — event settings, taxonomies, a form draft, a CFP draft
— and those keep their inline chip and no toast. It is _not_ the whole story
for these three: what confirmed the outcome is gone by the time the operator
looks for it. Sending an acceptance is followed by the next submission and the
inline confirmation only appears after a refetch; publishing is followed by the
version page or the public form; completing a task removes the control that was
pressed and moves focus to the list heading. The sr-only announcer already
carried these outcomes; the toast is the same confirmation for everyone else.

**Why the headshot upload is not one.** It was, and it was wrong. Nothing
navigates away from that surface: the uploader's own "Headshot updated" stays
rendered under the re-read image, so a card repeating the sentence puts it on
screen twice at once, and the only way to keep the screen reader from hearing
it twice was to demote that live region to plain text — trading away a real
announcement to make room for the card. That trade is only a bad one if the
region it gives up actually speaks, so the uploader's node has since been put in
the shape DEC-014 requires: one region, mounted with the card and empty, whose
text becomes "Uploading your headshot…" and then "Headshot updated". The rule
this leaves behind: a toast is for an outcome whose confirmation the operator
will not still be looking at.

**What is forbidden, and how this avoids it.** DEC-011 forbids "shipping a
toast provider with no real dispatch sites, purely so a scanner detects one".
Every dispatch site here is a real outcome, and
`tests/unit/app/toast.test.tsx` fails if the number of feature modules routing
through it drops.

**One live region per outcome (DEC-014) is preserved.** The visible card is
**not** a live region. `toast()` speaks through the single always-mounted app
announcer — which is more reliable than a region created in the same commit as
its text — and then draws the card. A screen reader hears each outcome once.
Where a surface keeps the same sentence on screen afterwards, that node is a
plain label rather than a second live region: the acceptance panel's
"Acceptance sent" is a `<span>`, and it is still the durable record.

**Never the only report.** Each of the three leaves its durable record behind —
the completed row, the send history, the version list. The toast can be missed
without anything being lost, which is why a 10-second auto-dismiss is safe.

**The rest of the contract.** Announced politely; dismissible by a labelled
button; auto-dismissed after `TOAST_DURATION_MS`; stacked newest-first and
capped at three so the stack cannot cover the surface the outcome happened on;
entrance animation behind `motion-safe:` with a `motion-reduce:` counterpart.
Dismissing gives focus back rather than dropping it: the next card if the stack
is not empty, otherwise wherever focus was before it entered the stack — a
control that removes itself and leaves focus on `<body>` sends the next Tab
back to the top of the document. Without a provider — how most unit tests
render a feature component — `toast()` degrades to exactly the announcer call
that preceded it, so an outcome is never silent.

**Revisit if.** A fourth outcome wants one. That is a decision to take here, not
in the component: the value of this list is that it is short and argued.

---

## DEC-016 — Which routes the navigation links, and which it deliberately does not

**Decision.** `nav-model.ts` links a destination only when that destination
works in this candidate.

- **Agenda** (`/admin/events/$slug/agenda`) is linked from the organizer nav.
  The screen reads `GET /api/admin/events/:slug/agenda`, which is delivered by
  the agenda workstream; the link and that endpoint are landed together, not
  separately.
- **Evaluations** (`/evaluations`) is not linked from anywhere. There is no
  `/api/public/evaluations` handler in this candidate, so every visit resolves
  to the "not open yet" state. A nav link to a page that cannot do its job is a
  dead control, and the public programme nav is exactly where a first-time
  visitor would trust it. The route stays reachable by URL for the evaluator
  flow that owns it, and `tests/unit/app/navigation.test.tsx` records the
  exception explicitly so the omission cannot be mistaken for an oversight.

**Why the difference.** Both routes exist; only one of them has a server behind
it here. Linking is a promise that pressing the link does something.

**Revisit if.** The evaluations API lands. At that point `/evaluations` joins
`publicDestinations()` and the exception in the fitness test is deleted.

---

## DEC-019 — Sonner replaces the in-house toast runtime

**Decision.** The toast is
[Sonner](https://sonner.emilkowal.ski/), shadcn/ui's toast component, mounted
once in the root shell through `src/components/ui/sonner.tsx`. The in-house
`src/components/ui/toast.tsx` from DEC-018 is deleted, not wrapped. Four
outcomes are routed through it: the acceptance message sent, a form version
published, a speaker task completed, and a headshot uploaded.

**Why replace a working component.** The in-house runtime was a private
re-implementation of a solved problem: a stack, a timer, a dismiss control,
focus restoration, and a reduced-motion path, all maintained here. Sonner is
the toast the rest of this app's component vocabulary already comes from, it is
standalone (no Radix, so `ui:check`'s Base UI lock is untouched), and swipe
dismissal, timer pausing while the tab is hidden, and hover-to-hold are
behaviour we never wrote and now get. Keeping both would have meant two toast
systems; keeping ours would have meant maintaining the weaker one.

**One live region per outcome (DEC-014) is preserved, and by the same
argument.** Sonner renders a permanent `<section aria-live="polite">` that is in
the accessibility tree from mount, before any outcome exists — the exact
property DEC-014 demands of a live region and the reason the app announcer was
preferred to a per-card region in the first place. It carries no ARIA role, so
it does not add a second page-global `role="status"` under every surface's own
status node. Because that region already speaks, the four call sites do **not**
also call `announce()`: two regions carrying one sentence say it twice.

**Why the headshot upload is one now.** DEC-018 excluded it because nothing
navigates away from that surface. That is true of `/headshot` and false of the
portal, which composes the uploader beside the task checklist the speaker moves
on to. The objection it raised — the same sentence on screen twice, spoken
twice — is answered the way the acceptance panel already answers it: the
uploader keeps "Headshot updated" as a plain label beside the re-read image, so
the durable record is untouched and only the toast speaks.

**Never the only report.** Unchanged from DEC-018 and enforced by
`tests/unit/app/toast.test.tsx`: the completed row, the send history, the
version list and the re-read headshot all survive their toast, and the test
fails if fewer than four feature modules dispatch through sonner or if a second
toast runtime reappears.

**What we gave up.** The in-house cards were labelled "Dismiss {message}" and
moved focus to the next card when one of a stack was dismissed. Sonner reads
one `closeButtonAriaLabel` for every card, so the label is the generic "Dismiss
notification", and it restores focus to whatever was focused before the stack
was entered rather than walking the stack. Both are worse in the narrow case of
three simultaneous cards and better in the common case of one; neither drops
focus on `<body>`, which is the guarantee that mattered (WCAG 2.4.3).

**Session published is missing on purpose.** It is the fourth outcome DEC-018
named and it belongs here, but the agenda surfaces
(`src/app/features/admin/AgendaAdminPage.tsx`, where the draft/published toggle
lives) are owned by another workstream in this candidate. That call site lands
with them.

**A test-environment consequence.** jsdom implements neither `matchMedia` nor
the pointer-capture API, both of which sonner uses unconditionally and every
real browser has. `tests/setup/jsdom-browser-apis.ts` stands them in for the
unit project, because the toaster is in the root shell and every test that
mounts the app would otherwise fail on an API that is never missing in
production.

---

## DEC-020 — The theme control answers its own letters, and only its own

**Decision.** With focus inside the visible theme control, `S`, `L` and `D`
select System, Light and Dark. The handler is `useThemePreferenceKeys` in
`src/components/ui/theme-provider.tsx`, attached by `ThemeToggle` to the
`role="group"` element and advertised there with `aria-keyshortcuts="S L D"`.
It listens on that container, never on the document, and ignores any letter
held with Alt, Ctrl or Meta.

**Why.** The control is a named group of exactly three options, so the letters
are the option names rather than a chord to memorise — the behaviour a native
`<select>` and every ARIA menu already have. Scoping it to the control is what
makes a bare letter safe: on the document, `d` would fire while someone was
only reading the page.

**How this sits with DEC-015.** It does not touch it. DEC-015 governs the app's
global modified D/L chords. Nothing here registers another document listener:
these letters work only inside the theme group. The two scopes are advertised
separately so assistive technology is not promised a page-wide bare-letter
shortcut.

**One guard, not two.** The handler reuses the exported `isEditableTarget`
rather than copying it, for the reason that helper is exported at all: it sits
on a container, so anything editable inside keeps its own keystrokes, and two
guards that could drift apart is how one of them ends up eating a keystroke in
a text field.

**Revisit if.** The control becomes a `role="radiogroup"` or a menu, where the
pattern's own typeahead rules apply and should be followed instead.
