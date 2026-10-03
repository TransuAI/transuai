import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PrivacyPage } from './privacy-page'
import { RegisterPage } from './register-page'

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ register: vi.fn() }) }))

// 隱私權說明（.scratch/account-deletion/issues/04）：註冊前就看得到，列出每個第三方送什麼、什麼時候送。
describe('PrivacyPage', () => {
  it('names the operator and every third party the recordings or their content go to', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '隱私權說明' })).toBeInTheDocument()
    expect(screen.getAllByText(/TransuAI/).length).toBeGreaterThan(0)
    for (const party of ['Deepgram', 'Tavily', 'Google（日曆、Gmail、Tasks）、Notion']) {
      expect(screen.getByText(party)).toBeInTheDocument()
    }
    expect(screen.getByText(/Hugging Face Inference Providers/)).toBeInTheDocument()
  })

  it('says only a rewritten search query goes to Tavily, and only when 查網路 is on', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)

    const tavily = screen.getByText('Tavily').parentElement!
    expect(within(tavily).getByText(/逐字稿與摘要本身不送/)).toBeInTheDocument()
    expect(within(tavily).getByText(/只有你在問答時打開「查網路」的那一題/)).toBeInTheDocument()
  })

  it('marks what still has to be filled in instead of making it up', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)

    expect(screen.getAllByText('［待補：聯絡 email］').length).toBeGreaterThan(0)
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
})
