package com.transuai.gateway.web.dto;

// 會後處理的設定：Notion 的會議紀錄父頁面與待辦資料庫，沒指定是 null。
public record PostMeetingSettingsDto(NotionLocationDto notionMeetingsPage, NotionLocationDto notionTodoDatabase) {

    // id 是頁面 ID 或資料庫的 data source ID（collection://…）；url 是使用者貼上的網址。
    public record NotionLocationDto(String id, String title, String url) {
    }
}
