package com.oralhealth.ui.line

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.oralhealth.MainActivity
import com.oralhealth.data.api.ApiClient
import com.oralhealth.data.local.TokenManager
import com.oralhealth.ui.login.LoginActivity
import kotlinx.coroutines.launch

class LineCallbackActivity : ComponentActivity() {

    private lateinit var tokenManager: TokenManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tokenManager = TokenManager(this)

        val token = intent?.data?.getQueryParameter("token")
        val error = intent?.data?.getQueryParameter("error")

        if (!token.isNullOrEmpty()) {

            ApiClient.setToken(token)

            lifecycleScope.launch {
                tokenManager.saveToken(token)
            }

            startActivity(Intent(this, MainActivity::class.java))
            finish()
        } else {
            startActivity(Intent(this, LoginActivity::class.java).apply {
                putExtra("line_error", error ?: "LINE login failed")
            })
            finish()
        }
    }
}

