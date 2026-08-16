const ZIP_KINDS = new Set(['document', 'headshot'])

/** Latest files the organizer ZIP should pack — documents and headshots. */
export function selectFilesForLatestZip<
  T extends { readonly kind: string; readonly ownerContactId: string },
>(files: readonly T[], ownerContactIds: readonly string[]): T[] {
  return files.filter((file) => {
    if (!ZIP_KINDS.has(file.kind)) return false
    return ownerContactIds.length === 0 || ownerContactIds.includes(file.ownerContactId)
  })
}

/** Path inside the ZIP. Headshots have no stored file name. */
export function zipEntryFileName(file: {
  readonly id: string
  readonly kind: string
  readonly fileName?: string | null
}): string {
  if (file.fileName !== null && file.fileName !== undefined && file.fileName.length > 0) {
    return file.fileName
  }
  return file.kind === 'headshot' ? 'headshot' : `${file.id}.bin`
}
