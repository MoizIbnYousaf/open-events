import type { FormId, FormVersion, VersionId, VersionNumber } from '../../domain'

export interface FormVersionRepository {
  findById(id: VersionId): Promise<FormVersion | null>
  listByForm(formId: FormId): Promise<readonly FormVersion[]>
  findLatestDraftByForm(formId: FormId): Promise<FormVersion | null>
  findByFormAndVersion(formId: FormId, version: VersionNumber): Promise<FormVersion | null>
}
