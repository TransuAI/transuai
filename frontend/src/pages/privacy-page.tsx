import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// 隱私權說明：資料存在哪裡、哪些會送到外部服務。系統由客戶部署在自己內部，蒐集者與聯絡窗口是部署的單位，
// 所以這頁不寫營運方與伺服器地區（見 .scratch/account-deletion/issues/04）。第三方清單是照程式碼盤點的——
// 新增會把資料送出去的服務時要一起更新這裡。
const APP_NAME = 'TransuAI'
const LAST_UPDATED = '2026-10-17'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  )
}

interface ThirdParty {
  name: string
  what: string
  when: string
}

// 錄音與它產生的內容會送到哪裡（都在美國，或由該服務自行決定處理地點）。
const THIRD_PARTIES: ThirdParty[] = [
  {
    name: 'Deepgram',
    what: '你上傳的錄音（影片只送抽出來的音軌）',
    when: '每次轉錄：把語音轉成文字並分出講者',
  },
  {
    name: 'Hugging Face Inference Providers（以及它轉給、實際執行模型的服務商）',
    what: '逐字稿的內容與片段、講者名稱、你問的問題、測驗與會後處理需要的內容',
    when: '使用平台提供的 AI 模型時：產生標題、摘要、章節、問答、測驗、講者名字建議、講者數據的問題與打斷、多格式輸出、翻譯逐字稿、抽出決策、標出可以查核的主張、會後處理，以及把逐字稿片段與決策轉成檢索用的向量',
  },
  {
    name: '你自己設定金鑰的 AI 廠商（OpenAI、Anthropic、Google Gemini、OpenRouter）',
    what: '同上',
    when: '只有在你存入自己的金鑰、並選用該廠商的模型時；資料由你和該廠商之間的約定處理',
  },
  {
    name: 'Tavily',
    what:
      '問答時，由你的問題改寫成的一句搜尋查詢；事實查核時，你勾選的每條主張整理成的一句話（兩者都可能含錄音裡提到的名詞，例如人名、產品名）；逐字稿與摘要本身不送',
    when: '只有你在問答時打開「查網路」的那一題，以及你在事實查核按下查核的主張（每條一次）',
  },
  {
    name: 'Google（日曆、Gmail、Tasks）、Notion',
    what: '你在會後處理中勾選要執行的內容（例如會議紀錄、待辦事項、行事曆活動）',
    when: '只有在你連結了帳號、並按下執行時；可以隨時在設定頁中斷連結（會向對方撤銷授權）',
  },
]

export function PrivacyPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-10 text-sm leading-relaxed">
      <header className="flex flex-col gap-2">
        <Link to="/" className="text-muted-foreground underline underline-offset-4">回到 {APP_NAME}</Link>
        <h1 className="text-2xl font-semibold">隱私權說明</h1>
        <p className="text-muted-foreground">最後更新：{LAST_UPDATED}</p>
        <p>
          {APP_NAME} 由你的單位部署在自己的伺服器上並自行管理。這裡說明系統存了哪些資料、為什麼、哪些會送到外部服務，以及你可以怎麼行使你的權利。
        </p>
      </header>

      <Section title="蒐集的目的">
        <p>
          提供你使用的服務：把你上傳的錄音轉成逐字稿、用 AI 產生摘要與其他內容、回答你的問題、在你同意時把結果送到你連結的服務；
          以及維持服務的安全（防止暴力破解與濫用）與計算用量（每月用量上限、平台成本）。
        </p>
      </Section>

      <Section title="蒐集的資料">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>帳號：email、顯示名稱、密碼（只存無法還原的雜湊）。</li>
          <li>你上傳的錄音或影片，以及由它產生的逐字稿、講者、摘要、章節、問答、測驗、會後處理紀錄；你寫的筆記與對逐字稿的修改。</li>
          <li>
            錄音裡可能有<strong>其他人的聲音與個人資料</strong>（例如會議的其他與會者）。上傳前請確認你有權這麼做（例如已告知與會者）。
          </li>
          <li>你存入的 AI 廠商金鑰（加密保存，畫面上只顯示末四碼）、你連結 Google、Notion 時取得的授權權杖（加密保存）、你的設定。</li>
          <li>用量：每次轉錄、AI 呼叫、網路搜尋的時間、模型與數量。</li>
          <li>連線資訊：IP 位址，只用來限制嘗試次數，保留時間以分鐘到小時計。</li>
        </ul>
      </Section>

      <Section title="誰會拿到你的資料">
        <p>
          資料存在你的單位部署這套系統的伺服器與檔案儲存。為了提供上面的功能，部分資料會送到以下第三方處理；它們的伺服器多在美國，
          資料會傳到臺灣以外的地方，並依各自的隱私權政策保存與使用。
        </p>
        <div className="flex flex-col gap-3">
          {THIRD_PARTIES.map((party) => (
            <div key={party.name} className="rounded-md border p-3">
              <p className="font-medium">{party.name}</p>
              <p><span className="text-muted-foreground">送出什麼：</span>{party.what}</p>
              <p><span className="text-muted-foreground">什麼時候：</span>{party.when}</p>
            </div>
          ))}
        </div>
        <p>
          Tavily 的政策表示查詢內容保留到不再需要為止、沒有明確期限，並可能用部分查詢內容改進他們的服務。介意的話，問答時不要打開「查網路」，也不要查核事實查核的主張。
        </p>
      </Section>

      <Section title="保存多久">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>錄音、逐字稿與 AI 產生的內容：保存到你刪除那個 Job，或刪除帳號。</li>
          <li>帳號資料、金鑰、授權權杖與設定：保存到你刪除它們（例如中斷連結），或刪除帳號。</li>
          <li>
            用量：刪除帳號時會<strong>去識別化</strong>——不再對應到你，只留下時間、模型與數量，用來計算平台每個月的總用量與成本。
          </li>
          <li>已經送到第三方的資料，依該第三方的政策保存。</li>
        </ul>
      </Section>

      <Section title="你的權利">
        <p>依個人資料保護法第 3 條，你可以：</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>查詢、閱覽：登入後在服務裡就看得到你所有的資料。</li>
          <li>製給複製本：每個 Job 都可以匯出逐字稿、摘要、問答、測驗與筆記。</li>
          <li>補充、更正：可以編輯逐字稿、講者名稱、標題與筆記。</li>
          <li>
            停止蒐集、處理、利用，或刪除：可以刪除單一 Job，或在<Link to="/settings" className="underline underline-offset-4">設定頁</Link>
            「帳號」刪除整個帳號——你的 Job、檔案、逐字稿、AI 產生的內容、筆記、金鑰、設定都會刪除，已連結的帳號會撤銷授權，無法復原。
          </li>
        </ul>
        <p>
          其他請求請洽你的單位管理這套系統的人員。
        </p>
      </Section>

      <Section title="不提供資料的影響">
        <p>
          email 與密碼是建立帳號的必要資料，沒有就不能使用服務。錄音只有在你要轉錄時才需要上傳；連結 Google、Notion、存入自己的金鑰、
          打開「查網路」都是選用的，不使用只是少了那些功能。
        </p>
      </Section>
    </div>
  )
}
