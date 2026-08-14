/**
 * STORE-only ZIP (no compression). Enough for a bulk download of already
 * compressed uploads. CRC32 is the ZIP one, not the ISO HDLC polynomial.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let crc = i
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    table[i] = crc >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  readonly name: string
  readonly body: Uint8Array
}

function dosDateTime(now: Date): { date: number; time: number } {
  const year = Math.max(1980, now.getUTCFullYear())
  const date = ((year - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate()
  const time = (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | (now.getUTCSeconds() >> 1)
  return { date, time }
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true)
}

/** Pack files into a .zip the organizer can download. Names must be relative. */
export function zipStoreFiles(files: readonly ZipEntry[], now: Date = new Date()): Uint8Array {
  const { date, time } = dosDateTime(now)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name.replace(/\\/g, '/'))
    const crc = crc32(file.body)
    const local = new Uint8Array(30 + nameBytes.length + file.body.length)
    const localView = new DataView(local.buffer)
    writeU32(localView, 0, 0x04034b50)
    writeU16(localView, 4, 20)
    writeU16(localView, 8, 0)
    writeU16(localView, 10, time)
    writeU16(localView, 12, date)
    writeU32(localView, 14, crc)
    writeU32(localView, 18, file.body.length)
    writeU32(localView, 22, file.body.length)
    writeU16(localView, 26, nameBytes.length)
    local.set(nameBytes, 30)
    local.set(file.body, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    writeU32(centralView, 0, 0x02014b50)
    writeU16(centralView, 4, 20)
    writeU16(centralView, 6, 20)
    writeU16(centralView, 10, 0)
    writeU16(centralView, 12, time)
    writeU16(centralView, 14, date)
    writeU32(centralView, 16, crc)
    writeU32(centralView, 20, file.body.length)
    writeU32(centralView, 24, file.body.length)
    writeU16(centralView, 28, nameBytes.length)
    writeU32(centralView, 42, offset)
    central.set(nameBytes, 46)
    centrals.push(central)
    offset += local.length
  }
  const centralStart = offset
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  writeU32(eocdView, 0, 0x06054b50)
  writeU16(eocdView, 8, files.length)
  writeU16(eocdView, 10, files.length)
  writeU32(eocdView, 12, centralSize)
  writeU32(eocdView, 16, centralStart)
  const out = new Uint8Array(offset + centralSize + eocd.length)
  let cursor = 0
  for (const part of locals) {
    out.set(part, cursor)
    cursor += part.length
  }
  for (const part of centrals) {
    out.set(part, cursor)
    cursor += part.length
  }
  out.set(eocd, cursor)
  return out
}
