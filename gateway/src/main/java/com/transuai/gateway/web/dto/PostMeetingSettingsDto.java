package com.transuai.gateway.web.dto;

// 會後處理的設定：Notion 的會議紀錄位置（每場會議建成它底下的子頁面，含待辦清單；沒指定是 null），以及待辦去處
// （GOOGLE_TASKS / NOTION：放在 Notion 會議紀錄裡的打勾清單）。
public record PostMeetingSettingsDto(NotionLocationDto notionMeetingsPage, String todoDestination) {

    // id 是頁面 ID；url 是使用者貼上的網址。
    public record NotionLocationDto(String id, String title, String url) {
    }
}
