# Five-minute demo script

Use four clean browser contexts. Never reuse a speaker cookie as a reviewer or
organizer cookie. Run mutations on acceptance only; production steps are
read-only.

| Time | Context                 | Action                                                   | Observable result                                                                   |
| ---- | ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0:00 | Attendee, production    | Open schedule, choose day, switch List/Track/Room        | The same eight published sessions remain available across views                     |
| 0:35 | Attendee, production    | Star one session and export My schedule                  | The calendar URL contains only the selected published session id                    |
| 0:55 | Attendee, production    | Open Speakers and one speaker detail                     | Initials render without broken or unreviewed imagery                                |
| 1:15 | Speaker, acceptance     | Open a valid CFP link, save, submit once                 | One focused confirmation appears and counts down eight seconds                      |
| 1:55 | Speaker, acceptance     | Continue to portal and inspect tasks/profile             | The submitted proposal and speaker-owned onboarding work are visible                |
| 2:20 | Organizer, acceptance   | Filter submissions by decision/routing, sort, export CSV | Count matches the desk and CSV contains exactly the displayed rows                  |
| 2:55 | Organizer, acceptance   | Open a proposal, assign reviewer, record decision        | Review state and append-only decision trail update                                  |
| 3:25 | Reviewer, acceptance    | Open assigned work, score or recuse                      | Only assigned event/proposal data is visible; recusal returns work to the organizer |
| 3:55 | Organizer, acceptance   | Open Readiness, filter a blocker, follow its proposal    | Blocked/incomplete work appears before complete work                                |
| 4:20 | Organizer, acceptance   | Resolve agenda conflict and publish                      | Public schedule changes only after a valid published placement                      |
| 4:45 | Organizer then attendee | Inspect message state, then reload public schedule/embed | Captured/queued/provider wording stays truthful and public output is updated        |

If a protected context expires, stop that lane and use its legitimate entry
method. Do not paste a persistent bearer link into a public field or recording.
If email delivery is unavailable, continue with the pre-seeded role contexts and
state that provider/inbox proof is not part of that run.
