// Downloads text generated in the browser as a file: Blob + object URL + a temporary
// <a download>. (For cross-origin URLs such as presigned media links `download` is ignored —
// those rely on the server's Content-Disposition instead.)
export function downloadTextFile({ fileName, content, mimeType }: { fileName: string; content: string; mimeType: string }) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke after the click has been handled, not synchronously inside it.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
