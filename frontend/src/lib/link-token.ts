// The one-use token in a link from a mail (重設密碼, 確認 email) comes after # — never sent to a server, not in logs or
// Referer. It is read once and taken out of the address bar, so it doesn't stay in the history either.
export function takeTokenFromAddress(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
  if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return token
}
