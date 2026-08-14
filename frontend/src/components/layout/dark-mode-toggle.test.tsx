import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { describe, expect, it } from 'vitest'
import { DarkModeToggle } from './dark-mode-toggle'

function renderToggle() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <DarkModeToggle collapsed={false} />
    </ThemeProvider>,
  )
}

describe('DarkModeToggle', () => {
  it('applies the dark class to the document root when toggled on', async () => {
    const user = userEvent.setup()
    renderToggle()

    expect(document.documentElement).not.toHaveClass('dark')

    await user.click(screen.getByRole('switch', { name: '切換深色模式' }))

    expect(document.documentElement).toHaveClass('dark')
  })

  it('removes the dark class when toggled back off', async () => {
    const user = userEvent.setup()
    renderToggle()

    const toggle = screen.getByRole('switch', { name: '切換深色模式' })
    await user.click(toggle)
    expect(document.documentElement).toHaveClass('dark')

    await user.click(toggle)
    expect(document.documentElement).not.toHaveClass('dark')
  })
})
