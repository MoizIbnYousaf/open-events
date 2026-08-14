/**
 * Still washes from the Perfect Paper file. Live WebGL shaders stay out of
 * the Worker until a measured need is recorded; these JPEGs are the same
 * OE-token stills used on the canvas.
 */

export type ShaderWashKind = 'mesh' | 'grain' | 'grain-hint'

const LIGHT_SRC: Record<ShaderWashKind, string> = {
  mesh: '/washes/mesh-light.jpg',
  grain: '/washes/grain-light.jpg',
  'grain-hint': '/washes/grain-light.jpg',
}

const DARK_SRC: Record<ShaderWashKind, string> = {
  mesh: '/washes/mesh-dark.jpg',
  grain: '/washes/grain-dark.jpg',
  'grain-hint': '/washes/grain-dark.jpg',
}

const HEIGHT: Record<ShaderWashKind, string> = {
  mesh: 'h-[560px]',
  grain: 'h-[280px]',
  'grain-hint': 'h-[140px]',
}

const OPACITY: Record<ShaderWashKind, string> = {
  mesh: 'opacity-70 dark:opacity-80',
  grain: 'opacity-30 dark:opacity-[0.32]',
  'grain-hint': 'opacity-[0.26] dark:opacity-[0.28]',
}

/** Map a public pathname to the wash the Perfect file uses on that surface. */
export function washKindForPath(pathname: string): ShaderWashKind | null {
  if (pathname === '/' || pathname === '') return 'mesh'
  if (pathname.startsWith('/cfp/')) return 'grain'
  if (pathname.startsWith('/schedule/')) return 'grain'
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return 'grain'
  if (pathname === '/evaluations' || pathname.startsWith('/evaluations')) return 'grain-hint'
  return null
}

export function ShaderWash({ kind }: { readonly kind: ShaderWashKind }) {
  return (
    <div
      aria-hidden="true"
      data-shader-wash={kind}
      className={`pointer-events-none absolute inset-x-0 top-0 overflow-hidden ${HEIGHT[kind]}`}
    >
      <img
        src={LIGHT_SRC[kind]}
        alt=""
        className={`h-full w-full object-cover dark:hidden ${OPACITY[kind]}`}
      />
      <img
        src={DARK_SRC[kind]}
        alt=""
        className={`hidden h-full w-full object-cover dark:block ${OPACITY[kind]}`}
      />
    </div>
  )
}
