import ReactMarkdown from 'react-markdown'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { StatusLive } from '../../../components/ui/status-live'
import { usePortalResources } from '../../queries/portal-resources'

function safeExternalUrl(value: string | undefined): string | null {
  if (value === undefined || value === '') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'mailto:' ? value : null
  } catch {
    return null
  }
}

export default function PortalResources() {
  const query = usePortalResources()

  if (query.isPending) {
    return <StatusLive aria-live="polite">Loading resources…</StatusLive>
  }
  if (query.isError) {
    return (
      <Card>
        <CardContent className="grid justify-items-start gap-3">
          <AlertLive>Resources are unavailable right now.</AlertLive>
          <Button
            type="button"
            variant="outline"
            pending={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? 'Trying again…' : 'Try again'}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const resources = query.data ?? []
  return (
    <section className="grid gap-3" aria-labelledby="portal-resources-title">
      <h2 id="portal-resources-title" className="font-heading text-lg font-semibold">
        Resources
      </h2>
      {resources.length === 0 ? (
        <EmptyState
          title="No resources yet"
          description="Guides and event links from the organizer appear here."
        />
      ) : (
        <div className="grid gap-3">
          {resources.map((resource) => (
            <Card key={resource.id}>
              <CardHeader className="border-b">
                <CardTitle level={3}>{resource.title}</CardTitle>
              </CardHeader>
              <CardContent>
                {resource.kind === 'link' ? (
                  safeExternalUrl(resource.url ?? undefined) === null ? (
                    <span className="text-sm text-muted-foreground">Link unavailable</span>
                  ) : (
                    <a
                      className="font-medium text-link underline underline-offset-4"
                      href={safeExternalUrl(resource.url ?? undefined) ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {resource.title}
                    </a>
                  )
                ) : (
                  <div className="grid gap-2 text-sm leading-6">
                    <ReactMarkdown
                      skipHtml
                      components={{
                        h1: ({ children }) => (
                          <h3 className="font-heading text-base font-semibold">{children}</h3>
                        ),
                        h2: ({ children }) => (
                          <h3 className="font-heading text-base font-semibold">{children}</h3>
                        ),
                        h3: ({ children }) => (
                          <h3 className="font-heading text-sm font-semibold">{children}</h3>
                        ),
                        ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
                        a: ({ href, children }) => {
                          const safe = safeExternalUrl(href)
                          return safe === null ? (
                            <span>{children}</span>
                          ) : (
                            <a
                              className="font-medium text-link underline underline-offset-4"
                              href={safe}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {children}
                            </a>
                          )
                        },
                        img: () => null,
                      }}
                    >
                      {resource.body ?? ''}
                    </ReactMarkdown>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
