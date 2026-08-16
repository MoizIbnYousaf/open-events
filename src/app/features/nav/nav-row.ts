/**
 * The one navigation-row recipe, shared by the organizer rail and the public
 * speaker/programme navs so the two never drift into different densities.
 *
 * 30px tall, 6px of optical padding, medium 14px label. A row at rest sits one
 * step down in muted ink and promotes to full-strength text on hover; the
 * current row carries a wash of the foreground colour rather than a brand fill,
 * because "where I am" is a statement about position, not about emphasis. The
 * wash is expressed as an alpha of the ink so it composes on the sidebar and on
 * the canvas alike, and deepens in dark mode where a 5% wash disappears.
 *
 * Plain TypeScript, no JSX: the public routes carry 20 kB budgets and must not
 * pull the organizer shell into their chunk just to borrow a class string.
 */
export const NAV_ROW_CLASS =
  'flex h-7.5 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground outline-hidden transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-foreground/5 aria-[current=page]:text-foreground dark:hover:bg-foreground/10 dark:aria-[current=page]:bg-foreground/10'
