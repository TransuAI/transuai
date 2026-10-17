import type { KeyboardEvent } from 'react'

/**
 * The keys of the in-place editors (片段 text, 講者 name): Enter saves, Esc cancels. While an IME is
 * composing, Enter confirms the characters being typed and Esc drops the composition — neither is
 * meant for the editor. (Safari reports the confirming Enter after compositionend, with keyCode 229.)
 */
export function handleEditorKeys(event: KeyboardEvent, { save, cancel }: { save: () => void; cancel: () => void }) {
  if (event.nativeEvent.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter') {
    event.preventDefault()
    save()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
}
