import type { EventId, FormVersionContent, VersionId } from '../../domain'

export interface FormContentRepository {
  loadByVersion(eventId: EventId, versionId: VersionId): Promise<FormVersionContent>
}
