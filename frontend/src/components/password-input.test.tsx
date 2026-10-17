import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PasswordInput, PasswordStrengthHint } from '@/components/password-input'

// 顯示密碼與密碼強度（.scratch/pre-launch-hardening/issues/15，ASVS 2.1.8、2.1.12）。
describe('PasswordInput', () => {
  it('hides what is typed until shown, and hides it again', async () => {
    const user = userEvent.setup()
    render(
      <>
        <label htmlFor="pw">密碼</label>
        <PasswordInput id="pw" />
      </>,
    )
    const input = screen.getByLabelText('密碼')
    await user.type(input, 'my secret words')
    expect(input).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: '顯示密碼' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('my secret words')
    expect(screen.getByRole('button', { name: '隱藏密碼' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '隱藏密碼' }))
    expect(input).toHaveAttribute('type', 'password')
  })
})

describe('PasswordStrengthHint', () => {
  it('states the rules, and the strength once something is typed', () => {
    const { rerender } = render(<PasswordStrengthHint id="hint" password="" />)
    expect(screen.getByText(/至少 12 個字元，最多 128 個/)).toBeInTheDocument()
    expect(screen.queryByText(/密碼強度/)).toBeNull()

    rerender(<PasswordStrengthHint id="hint" password="short" />)
    expect(screen.getByText('密碼強度：太短')).toBeInTheDocument()

    rerender(<PasswordStrengthHint id="hint" password="correct horse battery staple" />)
    expect(screen.getByText('密碼強度：強')).toBeInTheDocument()
  })
})
