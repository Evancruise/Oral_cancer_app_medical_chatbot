package com.oralhealth.data.model

/**
 * 給 LINE Login 用的請求 body
 * 通常丟 access token 或 id_token 給後端
 */
data class LoginLineRequest(
    val lineToken: String   // 一樣看你後端命名，必要時改成 line_token / accessToken
)