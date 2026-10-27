/** Hand the person a file: the share sheet where there is one (the phone app's
 * WebView has no downloads, so this is how it gets saved or sent on), else a
 * plain browser download. */
export async function saveFile(filename: string, blob: Blob, title: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
    } catch {
      // share sheet closed — nothing to do
    }
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** One CSV line — quoted where it has to be. */
export const csvRow = (cells: (string | number)[]) =>
  cells.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c))).join(',')
