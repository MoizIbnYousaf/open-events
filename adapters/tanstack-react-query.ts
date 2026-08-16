/**
 * Data-layer mutation primitive.
 *
 * UI components own pending copy and duplicate-submit prevention. Query
 * adapters own cache behavior, so they use a name that describes that role
 * instead of presenting themselves as UI action surfaces.
 */
export { useMutation as useServerMutation } from '@tanstack/react-query'
