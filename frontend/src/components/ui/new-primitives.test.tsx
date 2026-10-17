import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './sheet'
import { Switch } from './switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

describe('Sheet', () => {
  it('opens its content when the trigger is clicked', async () => {
    const user = userEvent.setup()
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
        </SheetContent>
      </Sheet>,
    )

    expect(screen.queryByText('Sheet title')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect(await screen.findByText('Sheet title')).toBeInTheDocument()
  })
})

describe('Tooltip', () => {
  it('renders a trigger wrapped in a provider without errors', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    expect(screen.getByText('Hover me')).toBeInTheDocument()
  })
})

describe('Switch', () => {
  it('renders as a toggleable checkbox-role control', () => {
    render(<Switch aria-label="Toggle" />)

    const toggle = screen.getByRole('switch', { name: 'Toggle' })
    expect(toggle).toBeInTheDocument()
    expect(toggle).not.toBeChecked()
  })
})
