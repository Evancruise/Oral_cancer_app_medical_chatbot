package com.oralhealth.data.model

/**
 * 給 Google Login 用的請求 body
 * 對應後端預期的欄位名稱（例如 idToken / id_token）
 */
data class LoginGoogleRequest(
    val idToken: String   // 如果後端用 id_token，就改成 val id_token: String
)