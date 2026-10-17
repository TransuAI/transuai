// Links to web pages (問答's 網路來源, 事實查核's sources): opened in a new tab, without telling the page where from.
export const WEB_LINK = { target: '_blank', rel: 'noopener noreferrer' } as const

/** A page's site, as shown next to its title (www. dropped). */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
