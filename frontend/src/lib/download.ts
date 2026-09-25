function clickTemporaryLink(href: string, downloadFileName?: string) {
  const link = document.createElement('a')
  link.href = href
  if (downloadFileName !== undefined) link.download = downloadFileName
  document.body.append(link)
  link.click()
  link.remove()
}

// Opens a server-provided download URL (e.g. a presigned link whose response carries
// Content-Disposition: attachment). For cross-origin URLs the `download` attribute is ignored,
// so it's the response header that makes the browser save the file instead of navigating.
export function openDownloadUrl(url: string) {
  clickTemporaryLink(url)
}

// Downloads text generated in the browser as a file: Blob + object URL + a temporary <a download>.
export function downloadTextFile({ fileName, content, mimeType }: { fileName: string; content: string; mimeType: string }) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
  clickTemporaryLink(url, fileName)
  // Revoke after the click has been handled, not synchronously inside it.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
