package com.oralhealth.ui.line

import android.app.Activity
import android.content.Intent
import androidx.core.net.toUri

object LineLoginHelper {

    // 這個 URL 是你後端要提供的「啟動 LINE Login」入口
    private const val LINE_LOGIN_ENTRY_URL =
        "http://127.0.0.1:5000/api/line/mobile/login"   // TODO: 換成你的後端網址

    fun startLogin(activity: Activity) {
        val intent = Intent(Intent.ACTION_VIEW, LINE_LOGIN_ENTRY_URL.toUri())
        activity.startActivity(intent)
    }
}