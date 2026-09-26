import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { connectionsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { leaveTo } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Connection } from '@/types/api'

const SERVICES = [
  { id: 'google', name: 'Google', purpose: 'Google 日曆、Gmail 草稿、Google Tasks' },
  { id: 'notion', name: 'Notion', purpose: 'Notion 頁面與資料庫' },
] as const

type Service = (typeof SERVICES)[number]

// Only names this page knows: the address can be crafted, so its text is never shown as is.
const serviceName = (id: string | null) => SERVICES.find((service) => service.id === id)?.name

// 已連結的帳號 (see ai-service CONTEXT.md): the outside services 會後處理 may use for this user. Linking happens on
// the service's own site; the Gateway sends the browser back here with ?connected= or ?connection_failed=.
export function ConnectedAccountsSection() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [unlinking, setUnlinking] = useState<Service | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    connectionsApi.list().then(setConnections).catch(() => toast.error('無法載入已連結的帳號'))
  }, [])

  // Back from Google / Notion: say how it went once, then drop the note from the address.
  useEffect(() => {
    const connected = searchParams.get('connected')
    const failed = searchParams.get('connection_failed')
    if (!connected && !failed) return
    if (connected) {
      const name = serviceName(connected)
      toast.success(name ? `已連結 ${name}` : '已連結帳號')
    }
    if (failed) {
      const name = serviceName(failed)
      toast.error(name ? `無法連結 ${name}，請再試一次` : '無法連結帳號，請再試一次')
    }
    setSearchParams(
      (params) => {
        params.delete('connected')
        params.delete('connection_failed')
        return params
      },
      { replace: true },
    )
  }, [searchParams, setSearchParams])

  const statusOf = (service: Service) =>
    connections.find((connection) => connection.service === service.id)?.status ?? 'NOT_CONNECTED'

  const link = (service: Service) =>
    connectionsApi.authorize(service.id).then(
      ({ authorizeUrl }) => leaveTo(authorizeUrl),
      (err) => toast.error(err instanceof ApiError ? err.message : `無法連結 ${service.name}`),
    )

  const confirmUnlink = async () => {
    if (!unlinking) return
    const service = unlinking
    try {
      const { revoked } = await connectionsApi.remove(service.id)
      setConnections((prev) =>
        prev.map((connection) =>
          connection.service === service.id ? { ...connection, status: 'NOT_CONNECTED', connectedAt: null } : connection,
        ),
      )
      if (revoked) toast.success(`已中斷 ${service.name} 的連結`)
      else toast.warning(`已中斷連結，但沒能通知 ${service.name} 撤銷授權，請到 ${service.name} 的設定移除 TransuAI`)
    } catch {
      toast.error('中斷連結失敗')
    }
  }

  return (
    <section aria-labelledby="connected-accounts-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="connected-accounts-heading" className="flex items-center gap-2 text-base font-medium">
          <Link2 className="size-4" />
          已連結的帳號
        </h2>
        <p className="text-sm text-muted-foreground">
          連結後，會後處理才能查詢你的行事曆與 Notion，並在你確認後建立待辦、活動、email 草稿與 Notion 頁面。中斷連結會同時撤銷授權。
        </p>
      </div>
      <div className="flex flex-col divide-y rounded-lg border">
        {SERVICES.map((service) => {
          const status = statusOf(service)
          return (
            <div key={service.id} role="group" aria-label={service.name} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{service.name}</span>
                  <span className="text-xs text-muted-foreground">{service.purpose}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {status === 'CONNECTED' ? '已連結' : status === 'NOT_CONNECTED' ? '未連結' : '已失效'}
                </span>
                {status !== 'CONNECTED' && (
                  <Button size="sm" onClick={() => void link(service)}>
                    {status === 'INVALID' ? '重新連結' : '連結'}
                  </Button>
                )}
                {status !== 'NOT_CONNECTED' && (
                  <Button size="sm" variant="outline" onClick={() => setUnlinking(service)}>
                    中斷連結
                  </Button>
                )}
              </div>
              {status === 'INVALID' && <p className="text-sm text-destructive">{service.name} 連結已失效，請重新連結</p>}
            </div>
          )
        })}
      </div>

      <AlertDialog open={!!unlinking} onOpenChange={(open) => !open && setUnlinking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>中斷 {unlinking?.name} 的連結？</AlertDialogTitle>
            <AlertDialogDescription>
              平台會向 {unlinking?.name} 撤銷授權並刪除權杖，之後會後處理就不能再使用 {unlinking?.name}。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmUnlink()}>中斷連結</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
