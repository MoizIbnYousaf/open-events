/** POST reads that deliberately keep private query input out of URLs. */
export function isReadOnlyRequest(method: string, endpoint: string): boolean {
  return method === 'POST' && /^\/api\/admin\/events\/[^/]+\/submission-desk\/query$/.test(endpoint)
}
