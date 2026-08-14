import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ShaderWash, washKindForPath } from '../../../src/components/ui/shader-wash'

afterEach(cleanup)

describe('washKindForPath', () => {
  it('puts mesh on the front door and grain on public surfaces', () => {
    expect(washKindForPath('/')).toBe('mesh')
    expect(washKindForPath('/cfp/demo-conf-2026/cfp')).toBe('grain')
    expect(washKindForPath('/schedule/demo-conf-2026')).toBe('grain')
    expect(washKindForPath('/portal')).toBe('grain')
    expect(washKindForPath('/evaluations')).toBe('grain-hint')
    expect(washKindForPath('/start')).toBeNull()
    expect(washKindForPath('/admin')).toBeNull()
  })
})

describe('ShaderWash', () => {
  it('renders the light still for a mesh hero', () => {
    const { container } = render(<ShaderWash kind="mesh" />)
    const light = container.querySelector('img:not(.dark\\:block)')
    expect(light).toHaveAttribute('src', '/washes/mesh-light.jpg')
    expect(container.querySelector('[data-shader-wash="mesh"]')).not.toBeNull()
  })

  it('renders the grain still for a public band', () => {
    const { container } = render(<ShaderWash kind="grain" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/washes/grain-light.jpg')
  })
})
