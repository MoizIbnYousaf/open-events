import '@testing-library/jest-dom/vitest'
import { createRef, useState } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Badge } from '../../../src/components/ui/badge'
import { Button } from '../../../src/components/ui/button'
import { Card, CardHeader, CardTitle } from '../../../src/components/ui/card'
import { ConfirmDialog } from '../../../src/components/ui/confirm-dialog'
import { EmptyState } from '../../../src/components/ui/empty-state'
import { Kbd } from '../../../src/components/ui/kbd'
import { NativeSelect } from '../../../src/components/ui/native-select'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderTitle,
} from '../../../src/components/ui/page-header'
import { SectionHeading, SECTION_HEADING_CLASS } from '../../../src/components/ui/section-heading'
import { StatusLive } from '../../../src/components/ui/status-live'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TABLE_LAYER,
} from '../../../src/components/ui/table'

afterEach(cleanup)

describe('Kbd', () => {
  it('renders a real <kbd> that is hidden from assistive tech by default', () => {
    const { container } = render(<Kbd>⌘K</Kbd>)
    const cap = container.querySelector('kbd')
    expect(cap).not.toBeNull()
    expect(cap).toHaveAttribute('aria-hidden', 'true')
    expect(cap).toHaveAttribute('data-slot', 'kbd')
    expect(cap).toHaveTextContent('⌘K')
  })

  it('can be announced when the cap is a word in a sentence', () => {
    const { container } = render(<Kbd aria-hidden={false}>⌘K</Kbd>)
    expect(container.querySelector('kbd')).toHaveAttribute('aria-hidden', 'false')
  })
})

describe('NativeSelect', () => {
  it('is a real <select> that user.selectOptions drives', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = useState('a')
      return (
        <>
          <label htmlFor="track">Track</label>
          <NativeSelect id="track" value={value} onChange={(event) => setValue(event.target.value)}>
            <option value="a">Platform</option>
            <option value="b">Design</option>
          </NativeSelect>
          <p>picked {value}</p>
        </>
      )
    }
    render(<Harness />)

    const select = screen.getByLabelText('Track')
    expect(select.tagName).toBe('SELECT')
    await user.selectOptions(select, 'b')
    expect(screen.getByText('picked b')).toBeInTheDocument()
  })

  it('reports native validity, so required + onInvalid can be intercepted', () => {
    const onInvalid = vi.fn()
    render(
      <NativeSelect aria-label="Track" required defaultValue="" onInvalid={onInvalid}>
        <option value="">Choose a track</option>
        <option value="a">Platform</option>
      </NativeSelect>,
    )

    const select = document.querySelector('select')
    if (select === null) throw new Error('no select rendered')
    expect(select.checkValidity()).toBe(false)
    select.reportValidity()
    expect(onInvalid).toHaveBeenCalled()
  })

  it('forwards a ref to the control, not to the wrapper', () => {
    const ref = createRef<HTMLSelectElement>()
    render(
      <NativeSelect ref={ref} aria-label="Track">
        <option value="a">Platform</option>
      </NativeSelect>,
    )
    expect(ref.current?.tagName).toBe('SELECT')
  })

  it('lands className on the control and containerProps on the wrapper', () => {
    const { container } = render(
      <NativeSelect
        aria-label="Track"
        className="control-marker"
        containerProps={{ className: 'wrapper-marker' }}
      >
        <option value="a">Platform</option>
      </NativeSelect>,
    )

    const select = screen.getByLabelText('Track')
    expect(select).toHaveClass('control-marker')
    const wrapper = document.querySelector('[data-slot="native-select-container"]') as HTMLElement
    expect(wrapper).toHaveClass('wrapper-marker')
    expect(wrapper).toContainElement(select)
    // The chevron cannot be painted inside a <select>, so it sits in the
    // wrapper — and must never be announced or hit-tested.
    const glyph = container.querySelector('svg')
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
    expect(glyph).toHaveClass('pointer-events-none')
  })
})

describe('CardTitle', () => {
  it('is a <div> by default: a page of cards is not a page of headings', () => {
    render(<CardTitle>Submissions</CardTitle>)
    const title = screen.getByText('Submissions')
    expect(title.tagName).toBe('DIV')
    expect(title).toHaveAttribute('data-slot', 'card-title')
  })

  it('renders a real heading on request without losing the recipe', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle level={2}>Submissions</CardTitle>
        </CardHeader>
      </Card>,
    )
    const heading = screen.getByRole('heading', { level: 2, name: 'Submissions' })
    expect(heading).toHaveAttribute('data-slot', 'card-title')
    expect(heading).toHaveClass('font-heading')
  })

  it('builds every rank around its children, never an empty heading', () => {
    render(<CardTitle level={4}>Rooms</CardTitle>)
    const heading = screen.getByRole('heading', { level: 4, name: 'Rooms' })
    expect(heading.tagName).toBe('H4')
    expect(heading).toHaveTextContent('Rooms')
  })

  it('still takes a render escape for an element no rank can express', () => {
    render(<CardTitle render={<summary />}>Advanced</CardTitle>)
    const title = screen.getByText('Advanced')
    expect(title.tagName).toBe('SUMMARY')
    expect(title).toHaveAttribute('data-slot', 'card-title')
    expect(title).toHaveClass('font-heading')
  })
})

describe('SectionHeading', () => {
  it('is an <h2> by default: a section title is document structure', () => {
    render(<SectionHeading>Conflicts</SectionHeading>)
    const heading = screen.getByRole('heading', { level: 2, name: 'Conflicts' })
    expect(heading).toHaveAttribute('data-slot', 'section-heading')
    expect(heading).toHaveClass('font-heading')
  })

  it('renders a deeper level on request without losing the recipe', () => {
    render(<SectionHeading level={3}>Routing</SectionHeading>)
    const heading = screen.getByRole('heading', { level: 3, name: 'Routing' })
    expect(heading).toHaveAttribute('data-slot', 'section-heading')
    expect(heading).toHaveClass('font-heading', 'font-medium')
  })

  it('names the heading from its children at every rank', () => {
    render(<SectionHeading level={6}>Conflicts</SectionHeading>)
    const heading = screen.getByRole('heading', { level: 6, name: 'Conflicts' })
    expect(heading.tagName).toBe('H6')
    expect(heading).toHaveTextContent('Conflicts')
  })

  it('still takes a render escape for an element no rank can express', () => {
    render(<SectionHeading render={<legend />}>Filters</SectionHeading>)
    const title = screen.getByText('Filters')
    expect(title.tagName).toBe('LEGEND')
    expect(title).toHaveAttribute('data-slot', 'section-heading')
    expect(title).toHaveClass('font-heading', 'font-medium')
  })

  it('forwards a ref, so a focus contract can point at the heading', () => {
    const ref = createRef<HTMLHeadingElement>()
    render(
      <SectionHeading ref={ref} tabIndex={-1}>
        Your tasks
      </SectionHeading>,
    )
    expect(ref.current?.tagName).toBe('H2')
  })

  it('publishes the recipe as a string for files the entry chunk reaches', () => {
    // The five AgendaAdminPage near-copies dropped `font-heading`, which is
    // invisible while --font-heading aliases --font-sans and a visible
    // regression the moment it does not. One definition, or none of this holds.
    expect(SECTION_HEADING_CLASS).toContain('font-heading')
    render(<SectionHeading>Sessions</SectionHeading>)
    for (const token of SECTION_HEADING_CLASS.split(' ')) {
      expect(screen.getByRole('heading', { name: 'Sessions' })).toHaveClass(token)
    }
  })
})

describe('ConfirmDialog', () => {
  it('mounts a caller status slot inside the dialog', async () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Publish agenda"
        description="This action cannot be undone."
        confirmLabel="Publish"
        onConfirm={() => undefined}
      >
        <StatusLive>Publishing failed. Try again.</StatusLive>
      </ConfirmDialog>,
    )

    const dialog = await screen.findByRole('dialog')
    // The live region has to live inside the dialog: a failure reported behind
    // the modal is a failure nobody hears.
    expect(within(dialog).getByText('Publishing failed. Try again.')).toBeInTheDocument()
  })

  it('still renders without a status slot', async () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Publish agenda"
        description="This action cannot be undone."
        confirmLabel="Publish"
        onConfirm={() => undefined}
      />,
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('keeps focus inside the open dialog for the whole in-flight window', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      const [pending, setPending] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Remove from schedule
          </button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Remove Ada Lovelace"
            description="This action cannot be undone."
            confirmLabel="Remove"
            pending={pending}
            onConfirm={() => setPending(true)}
          />
        </>
      )
    }
    render(<Harness />)

    const opener = screen.getByRole('button', { name: 'Remove from schedule' })
    opener.focus()
    await user.click(opener)

    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Remove' })
    confirm.focus()
    await user.click(confirm)

    // The dialog deliberately stays open until the server settles (C0 §8), so
    // this is the whole window in which a natively disabled confirm would have
    // dropped the reader onto <body>, outside a modal that is still on screen.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(confirm).toHaveFocus()

    // Cancel goes inert the same way: it must refuse to fire mid-flight without
    // becoming a hole the focus can fall through.
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveAttribute('aria-disabled', 'true')
    expect(cancel).not.toHaveAttribute('aria-busy')
    await user.click(cancel)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  // V1-N4: the two ways to leave a dialog without answering it. This one stays
  // open across the request on purpose, so a mid-flight dismissal closed the
  // surface that owns the outcome and left the reader with a request they could
  // no longer watch fail.
  it('ignores Escape and a backdrop dismissal while the action is in flight', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Publish agenda"
        description="Speakers see the schedule immediately."
        confirmLabel="Publish"
        pending
        onConfirm={() => undefined}
      />,
    )
    const dialog = await screen.findByRole('dialog')
    within(dialog).getByRole('button', { name: 'Publish' }).focus()

    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(document.body)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('still lets Escape close it when nothing is in flight', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Publish agenda"
        description="Speakers see the schedule immediately."
        confirmLabel="Publish"
        onConfirm={() => undefined}
      />,
    )
    const dialog = await screen.findByRole('dialog')
    within(dialog).getByRole('button', { name: 'Cancel' }).focus()

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('returns focus to the opener when the caller closes it on success', async () => {
    const user = userEvent.setup()
    function Harness({ open, pending }: { readonly open: boolean; readonly pending: boolean }) {
      return (
        <>
          <button type="button">Publish agenda</button>
          <ConfirmDialog
            open={open}
            onOpenChange={() => undefined}
            title="Publish agenda"
            description="Speakers see the schedule immediately."
            confirmLabel="Publish"
            tone="default"
            pending={pending}
            onConfirm={() => undefined}
          />
        </>
      )
    }
    const { rerender } = render(<Harness open={false} pending={false} />)
    const opener = screen.getByRole('button', { name: 'Publish agenda' })
    opener.focus()

    rerender(<Harness open pending={false} />)
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Publish' })
    await user.click(confirm)

    rerender(<Harness open pending />)
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }),
    ).toHaveFocus()

    // Success closes the dialog from the caller, and the reader lands back on
    // the control that opened it — not on <body>, and not on a control that is
    // now permanently disabled.
    rerender(<Harness open={false} pending={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })
})

describe('Button pending', () => {
  function PendingHarness({ onPress }: { readonly onPress: () => void }) {
    const [pending, setPending] = useState(false)
    return (
      <>
        <Button
          pending={pending}
          onClick={() => {
            onPress()
            setPending(true)
          }}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <button type="button" onClick={() => setPending(false)}>
          settle
        </button>
      </>
    )
  }

  it('keeps focus on the control that was pressed for the whole pending cycle', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(<PendingHarness onPress={onPress} />)

    const save = screen.getByRole('button', { name: 'Save' })
    save.focus()
    await user.keyboard('{Enter}')

    const busy = screen.getByRole('button', { name: 'Saving…' })
    expect(busy).toBe(save)
    // The whole finding in one assertion: this used to be document.body.
    expect(busy).toHaveFocus()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).not.toBeDisabled()

    // Inert means inert: neither a second click nor a second Enter may fire it.
    await user.click(busy)
    await user.keyboard('{Enter}')
    expect(onPress).toHaveBeenCalledTimes(1)

    // Tab is the exception — being busy is not a focus trap.
    await user.tab()
    expect(screen.getByRole('button', { name: 'settle' })).toHaveFocus()
  })

  it('still uses the native attribute for a genuinely disabled control', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <>
        <button type="button">before</button>
        <Button disabled onClick={onPress}>
          Send acceptance
        </Button>
        <button type="button">after</button>
      </>,
    )
    const button = screen.getByRole('button', { name: 'Send acceptance' })
    // "There is nothing to do here" is a different statement from "this is
    // running", and a control nobody can act on has no claim on the tab order.
    expect(button).toBeDisabled()
    expect(button).not.toHaveAttribute('aria-busy')

    // Out of the tab order: tabbing from its predecessor lands on its
    // successor, never on the disabled control.
    screen.getByRole('button', { name: 'before' }).focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
    expect(button).not.toHaveFocus()

    // And nothing fires it: not a click, not a programmatic focus + Enter.
    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}')
    expect(onPress).not.toHaveBeenCalled()
  })
})

describe('Badge', () => {
  it('carries no state marker unless one is asked for', () => {
    const { container } = render(<Badge>Track: Platform</Badge>)
    const badge = container.querySelector('[data-slot="badge"]') as HTMLElement

    // A dot is a claim that the chip names a state. A track name is not one, so
    // the default chip must not make the claim.
    expect(badge).not.toHaveAttribute('data-dot')
    expect(badge).not.toHaveAttribute('data-pending')
    expect(badge.className).not.toContain('before:')
    expect(badge).toHaveTextContent('Track: Platform')
  })

  it('draws the marker as a pseudo-element painted from its own text colour', () => {
    const { container } = render(<Badge dot>Accepted</Badge>)
    const badge = container.querySelector('[data-slot="badge"]') as HTMLElement

    expect(badge).toHaveAttribute('data-dot', '')
    expect(badge).toHaveClass(
      'before:size-1',
      'before:rounded-full',
      'before:bg-current',
      "before:content-['']",
    )
    // The marker inherits the chip's ink, so it can never disagree with the
    // word beside it — and it is a pseudo-element, so it adds no child node for
    // the `[&>svg]` recipe or the chip-in-a-cell DOM contracts to trip over.
    expect(badge.childElementCount).toBe(0)
    expect(badge).toHaveTextContent('Accepted')
  })

  it('animates that same marker while a state change is in the air, and says nothing', () => {
    const { container } = render(<Badge pending>Draft</Badge>)
    const badge = container.querySelector('[data-slot="badge"]') as HTMLElement

    expect(badge).toHaveAttribute('data-pending', '')
    // Pending brings the dot with it: animating a marker that was never
    // rendered would be a wait with no indicator at all.
    expect(badge).toHaveAttribute('data-dot', '')
    expect(badge).toHaveClass('before:animate-pulse', 'before:size-1')
    // A looping animation names the state it rests in — that value is what the
    // global reduced-motion collapse leaves on screen.
    expect(badge).toHaveClass('before:opacity-100')

    // The label is the state the reader last had confirmed; it stays true until
    // the server says otherwise, and it is asserted verbatim elsewhere.
    expect(badge).toHaveTextContent('Draft')
    expect(badge.childElementCount).toBe(0)

    // Visual-only, deliberately: this product allows exactly one live region
    // and the shell already spends it, so a chip that announced itself would be
    // the second one.
    expect(badge).not.toHaveAttribute('role')
    expect(badge).not.toHaveAttribute('aria-live')
    expect(badge).not.toHaveAttribute('aria-busy')
    expect(container.querySelector('[role="status"],[aria-live]')).toBeNull()
  })
})

describe('Table', () => {
  // Scoped to this block: only the table reaches for a ResizeObserver, and the
  // stand-in one of its tests installs must not outlive it.
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes container props and a container ref to the scroll wrapper', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Table containerRef={ref} containerProps={{ style: { ['--scroll-edge' as string]: '1' } }}>
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    const scroller = document.querySelector('[data-slot="table-container"]') as HTMLElement
    expect(ref.current).toBe(scroller)
    expect(scroller).toHaveAttribute('data-slot', 'table-container')
    expect(scroller.style.getPropertyValue('--scroll-edge')).toBe('1')
    // The tab stop is the contract that makes a text-only table scrollable by
    // keyboard; passthrough must not cost it.
    expect(scroller).toHaveAttribute('tabindex', '0')
  })

  it('draws its own frame when bordered, so callers stop hand-wrapping it', () => {
    const { container } = render(
      <Table bordered>
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const scroller = container.querySelector('[data-slot="table-container"]')
    expect(scroller).toHaveClass('ring-1', 'ring-border', 'rounded-lg')
  })

  it('is unframed by default', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(container.querySelector('[data-slot="table-container"]')).not.toHaveClass('ring-1')
  })

  it('names its scroll region from the caption and rings it on focus', () => {
    render(
      <Table>
        <TableCaption className="sr-only">Proposals submitted to this event</TableCaption>
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    const scroller = document.querySelector('[data-slot="table-container"]') as HTMLElement
    const caption = document.querySelector('caption') as HTMLElement
    // A focusable container with no name announces as a bare group; the caption
    // that already names the table names the region that holds it.
    expect(scroller).toHaveAttribute('role', 'group')
    expect(scroller.getAttribute('aria-labelledby')).toBe(caption.id)
    expect(caption.id).not.toBe('')
    // …and it is a real tab stop, so it wears the product's ring rather than
    // the browser's default 1px outline.
    expect(scroller).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring')
  })

  it('claims no name when there is no caption to supply one', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const scroller = document.querySelector('[data-slot="table-container"]') as HTMLElement
    // Pointing at an id nobody rendered would name it nothing while claiming
    // it was named.
    expect(scroller).not.toHaveAttribute('aria-labelledby')
  })

  it('flips the scroll-edge custom properties as the container scrolls', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const scroller = document.querySelector('[data-slot="table-container"]') as HTMLElement
    // Nothing scrolled yet: both edges are clean, so neither shadow is painted.
    expect(scroller.dataset.scrollStart).toBe('false')

    Object.defineProperty(scroller, 'scrollWidth', { value: 800, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 400, configurable: true })
    scroller.scrollLeft = 200
    scroller.dispatchEvent(new Event('scroll'))
    // Content is hidden on both sides now, and both edges say so.
    expect(scroller.dataset.scrollStart).toBe('true')
    expect(scroller.dataset.scrollEnd).toBe('true')

    scroller.scrollLeft = 400
    scroller.dispatchEvent(new Event('scroll'))
    expect(scroller.dataset.scrollStart).toBe('true')
    expect(scroller.dataset.scrollEnd).toBe('false')
  })

  it('ignores a resize frame that moved the width by a pixel or less', () => {
    // jsdom implements no ResizeObserver, so the primitive skips it entirely
    // here unless a stand-in is supplied. This one keeps the callbacks so the
    // test can hand the effect the frames a window drag would.
    const frames: ResizeObserverCallback[] = []
    class RecordingResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        frames.push(callback)
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', RecordingResizeObserver)

    const resizeTo = (width: number) => {
      const entry = { contentRect: { width } } as unknown as ResizeObserverEntry
      for (const frame of frames) frame([entry], {} as ResizeObserver)
    }

    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const scroller = document.querySelector('[data-slot="table-container"]') as HTMLElement

    // A first frame always measures — there is no previous width to compare to.
    Object.defineProperty(scroller, 'scrollWidth', { value: 800, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 400, configurable: true })
    resizeTo(400)
    expect(scroller.dataset.scrollEnd).toBe('true')
    expect(scroller.dataset.scrollStart).toBe('false')

    // Now put the container in a state a measurement WOULD notice: scrolled far
    // enough that the start edge has content behind it. A sub-pixel frame must
    // leave the attributes exactly where they were, which is only possible if
    // the callback never read the layout at all.
    scroller.scrollLeft = 200
    resizeTo(400.4)
    resizeTo(399.6)
    expect(scroller.dataset.scrollStart).toBe('false')

    // …and the guard is a threshold, not a mute: a real resize still lands, at
    // once, with no settle delay in front of it.
    resizeTo(420)
    expect(scroller.dataset.scrollStart).toBe('true')
    expect(scroller.dataset.scrollEnd).toBe('true')
  })

  it('keeps every sticky recipe on the named z-index rung', () => {
    // The recipes are literals so Tailwind can compile them; this is what stops
    // the literals drifting away from the ladder they are supposed to obey.
    render(
      <Table>
        <TableHeader sticky>
          <TableRow>
            <TableHead pinned>Title</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell pinned>A talk</TableCell>
            <TableCell>Pending</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    expect(document.querySelector('thead')).toHaveClass(`[&_th]:${TABLE_LAYER.header}`)
    const pinnedHead = document.querySelector('th[data-pinned]') as HTMLElement
    const pinnedCell = document.querySelector('td[data-pinned]') as HTMLElement
    expect(pinnedHead).toHaveClass('sticky', 'left-0', TABLE_LAYER.header)
    expect(pinnedCell).toHaveClass('sticky', 'left-0', TABLE_LAYER.pinnedCell)
    // Column heads sit above the pinned column, which sits above the footer.
    const rung = (name: string) => Number(name.replace('z-', ''))
    expect(rung(TABLE_LAYER.header)).toBeGreaterThan(rung(TABLE_LAYER.pinnedCell))
    expect(rung(TABLE_LAYER.pinnedCell)).toBeGreaterThan(rung(TABLE_LAYER.footer))
  })

  it('paints a pinned cell from the row wash, in one class a caller can override', () => {
    render(
      <Table>
        <TableBody>
          {/* Exactly what SubmissionList passes. */}
          <TableRow className="hover:bg-muted">
            <TableCell pinned className="group-hover/row:bg-muted">
              A talk
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const row = document.querySelector('tr') as HTMLElement
    const cell = document.querySelector('td[data-pinned]') as HTMLElement

    // The pinned cell reads the row's published background rather than guessing
    // at it, so the two can never disagree.
    expect(cell).toHaveClass('bg-[var(--table-row-bg)]')
    expect(row.className).toContain('[--table-row-bg:')
    expect(row.className).toContain('hover:[--table-row-bg:var(--table-row-hover)]')

    // The row's own hover wash is ONE class, so tailwind-merge collapses the
    // caller's override in both schemes. The previous `dark:hover:` twin
    // survived the merge and won the dark theme back, which is exactly how the
    // pinned column ended up a different colour from its own row on hover.
    expect(row).toHaveClass('hover:bg-muted')
    expect(row.className).not.toMatch(/dark:hover:bg-/)
  })
})

describe('EmptyState', () => {
  it('tints icon and title destructive in the error tone', () => {
    const { container } = render(
      <EmptyState tone="error" icon={<svg />} title="We could not load submissions" />,
    )
    const root = container.querySelector('[data-slot="empty-state"]')
    expect(root).toHaveAttribute('data-tone', 'error')
    expect(container.querySelector('[data-slot="empty-state-icon"]')).toHaveClass(
      'text-destructive',
    )
    expect(container.querySelector('[data-slot="empty-state-title"]')).toHaveClass(
      'text-destructive',
    )
  })

  it('defaults to the neutral tone', () => {
    const { container } = render(<EmptyState title="Publish your programme" />)
    const root = container.querySelector('[data-slot="empty-state"]')
    expect(root).toHaveAttribute('data-tone', 'default')
    expect(container.querySelector('[data-slot="empty-state-title"]')).toHaveClass(
      'text-foreground',
    )
  })

  it('accepts a live-region node as the title', () => {
    render(<EmptyState title={<StatusLive>Loading failed.</StatusLive>} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading failed.')
  })

  it('keeps the title ink when the title is a live region', () => {
    const { container } = render(
      <EmptyState title={<StatusLive>No sessions are scheduled yet.</StatusLive>} />,
    )
    const title = container.querySelector('[data-slot="empty-state-title"]')
    // StatusLive is muted by default, which on three surfaces left the empty
    // box with a grey title at the same size and weight as its own
    // description — a box with no hierarchy at all. Announced is not quieter.
    expect(title).toHaveClass('text-foreground', '[&_[role=status]]:text-inherit')
  })
})

/**
 * The page toolbar is a LAYOUT contract, and jsdom cannot measure layout — so
 * what is pinned here is the set of classes the measured behaviour rests on.
 * Each one closes a finding that was reproduced in a real browser.
 */
describe('PageHeader', () => {
  it('is the sticky 56px toolbar the scroll offset is calculated from', () => {
    const { container } = render(
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Submissions</PageHeaderTitle>
        </PageHeaderContent>
      </PageHeader>,
    )
    const root = container.querySelector('[data-slot="page-header"]')
    // R1-M1: #main's scroll-padding-top is set to --navbar-height, which is
    // only the right offset while this row is what sits at the top of it.
    expect(root).toHaveClass(
      'lg:sticky',
      'lg:top-0',
      'lg:h-14',
      'lg:border-b',
      'lg:bg-background',
      'lg:z-40',
    )
  })

  it('lets a long title shrink instead of pushing the page sideways', () => {
    const { container } = render(
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>
            Reproducible-builds-for-multi-tenant-edge-workers-and-their-discontents
          </PageHeaderTitle>
        </PageHeaderContent>
        <PageHeaderActions>
          <span>Pending</span>
        </PageHeaderActions>
      </PageHeader>,
    )
    const root = container.querySelector('[data-slot="page-header"]')
    // V9-N1: a flex item's min-width defaults to auto, so without this the row
    // refused to narrow past its own title and the submission detail scrolled
    // sideways at 390px. Truncation cannot happen inside a row that will not
    // shrink, which is why all three of these have to hold together.
    expect(root).toHaveClass('flex', 'min-w-0')
    expect(container.querySelector('[data-slot="page-header-content"]')).toHaveClass('min-w-0')
    expect(container.querySelector('[data-slot="page-header-title"]')).toHaveClass('truncate')
  })

  it('keeps the actions from shrinking so the title is what gives way', () => {
    const { container } = render(
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Agenda</PageHeaderTitle>
        </PageHeaderContent>
        <PageHeaderActions>
          <button type="button">Publish agenda</button>
        </PageHeaderActions>
      </PageHeader>,
    )
    expect(container.querySelector('[data-slot="page-header-actions"]')).toHaveClass('shrink-0')
  })
})
