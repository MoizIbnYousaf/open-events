import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

import { cn } from '../../lib/utils'
import { linkVariants, type LinkVariants } from './link-variants'

/**
 * A text link the app renders itself: a plain `href`, a download, a mailto.
 *
 * A ROUTER link wears the recipe instead of going through here, so the anchor
 * keeps its own text:
 *
 *   <Link to="/admin" className={linkVariants()}>Admin</Link>
 *
 * `render` remains for the rare element that is neither — it swaps the tag
 * without losing the recipe.
 */
function TextLink({
  className,
  variant = 'default',
  hit = false,
  render,
  ...props
}: useRender.ComponentProps<'a'> & LinkVariants) {
  return useRender({
    defaultTagName: 'a',
    props: mergeProps<'a'>(
      {
        className: cn(linkVariants({ variant, hit }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'link',
      variant,
    },
  })
}

export { TextLink }
