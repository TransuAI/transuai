import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/context/auth-context'
import { ProtectedRoute } from '@/components/protected-route'
import { AppShell } from '@/components/layout/app-shell'
import { LoginPage } from '@/pages/login-page'
import { RegisterPage } from '@/pages/register-page'
import { PrivacyPage } from '@/pages/privacy-page'
import { ForgotPasswordPage } from '@/pages/forgot-password-page'
import { ResetPasswordPage } from '@/pages/reset-password-page'
import { VerifyEmailPage } from '@/pages/verify-email-page'
import { UploadPage } from '@/pages/upload-page'
import { SettingsPage } from '@/pages/settings-page'
import { JobsPage } from '@/pages/jobs-page'
import { JobDetailPage } from '@/pages/job-detail-page'
import { DecisionsPage } from '@/pages/decisions-page'
import { SystemSettingsPage } from '@/pages/system-settings-page'
import { SetNewPasswordPage } from '@/pages/set-new-password-page'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          {/* 隱私權說明：註冊前就要看得到，不用登入 */}
          <Route path="/privacy" element={<PrivacyPage />} />
          {/* 忘記密碼：還沒登入 */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />

          <Route element={<ProtectedRoute />}>
            {/* 安裝時建立的管理員第一次登入：先換掉產生的密碼 */}
            <Route path="/set-password" element={<SetNewPasswordPage />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/jobs" replace />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/jobs/:jobId" element={<JobDetailPageOfJob />} />
              <Route path="/decisions" element={<DecisionsPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin/settings" element={<SystemSettingsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

// One page per job: following a link from one job to another (取代 links do) starts the page afresh.
function JobDetailPageOfJob() {
  const { jobId } = useParams<{ jobId: string }>()
  return <JobDetailPage key={jobId} />
}
