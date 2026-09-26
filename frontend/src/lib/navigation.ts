// Leave the app for another site (e.g. Google's or Notion's sign-in to link an account). Its own module so tests
// can stand in for it: jsdom can't navigate.
export function leaveTo(url: string): void {
  window.location.assign(url)
}
