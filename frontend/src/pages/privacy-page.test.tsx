import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PrivacyPage } from './privacy-page'
import { RegisterPage } from './register-page'

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ register: vi.fn() }) }))

// 隱私權說明（.scratch/account-deletion/issues/04）：註冊前就看得到，列出每個第三方送什麼、什麼時候送。
describe('PrivacyPage', () => {
  it('names the product and every third party the recordings or their content go to', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '隱私權說明' })).toBeInTheDocument()
    expect(screen.getAllByText(/TransuAI/).length).toBeGreaterThan(0)
    for (const party of ['Deepgram', 'Tavily', 'Google（日曆、Gmail、Tasks）、Notion']) {
      expect(screen.getByText(party)).toBeInTheDocument()
    }
    expect(screen.getByText(/Hugging Face Inference Providers/)).toBeInTheDocument()
  })

  it('says only a rewritten search query or a ticked claim goes to Tavily, and only when 查網路 is on or a claim is checked', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)

    const tavily = screen.getByText('Tavily').parentElement!
    expect(within(tavily).getByText(/逐字稿與摘要本身不送/)).toBeInTheDocument()
    expect(within(tavily).getByText(/事實查核時，你勾選的每條主張整理成的一句話/)).toBeInTheDocument()
    expect(within(tavily).getByText(/只有你在問答時打開「查網路」的那一題，以及你在事實查核按下查核的主張（每條一次）/)).toBeInTheDocument()
  })

  // 部署在客戶內部：沒有營運方的聯絡方式與伺服器地區要填，其他請求找部署的單位
  it('points other requests to the organization that deployed it, with nothing left to fill in', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)

    expect(screen.getByText(/由你的單位部署在自己的伺服器上/)).toBeInTheDocument()
    expect(screen.getByText(/其他請求請洽你的單位管理這套系統的人員/)).toBeInTheDocument()
    expect(screen.queryByText(/待補/)).not.toBeInTheDocument()
  })
})

describe('RegisterPage', () => {
  it('links to the privacy notice before signing up', () => {
    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '隱私權說明' })).toHaveAttribute('href', '/privacy')
  })

  it('asks for a password of at least 12 characters', () => {
    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const password = screen.getByLabelText('密碼')
    expect(password).toHaveAttribute('minLength', '12')
    expect(password).toHaveAccessibleDescription(/至少 12 個字元，最多 128 個/)
  })
})
