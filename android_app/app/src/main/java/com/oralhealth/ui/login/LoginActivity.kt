package com.oralhealth.ui.login

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.oralhealth.MainActivity
import com.oralhealth.R
import com.oralhealth.data.api.ApiClient
import com.oralhealth.data.local.TokenManager
import com.oralhealth.ui.google.GoogleLoginHelper
import com.oralhealth.ui.line.LineLoginHelper
import com.oralhealth.ui.theme.OralHealthAppTheme
import kotlinx.coroutines.launch

class LoginActivity : ComponentActivity() {

  private lateinit var tokenManager: TokenManager
  private val viewModel: LoginViewModel by viewModels()

  private lateinit var googleLauncher: ActivityResultLauncher<Intent>

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    tokenManager = TokenManager(this)

    // 🔹 初始化 Google Sign-In client
    GoogleLoginHelper.initGoogleLogin(
      this,
      getString(R.string.google_web_client_id)
    )

    // 🔹 STEP 1 — 定義 Google Login Launcher
    googleLauncher = registerForActivityResult(
      ActivityResultContracts.StartActivityForResult()
    ) { result ->
      GoogleLoginHelper.handleLoginResult(
        result.data,
        onSuccess = { idToken ->
          viewModel.loginWithGoogleToken(idToken)
        },
        onError = { msg ->
          Log.e("GoogleLogin", msg)
        }
      )
    }

    // 🔹 STEP 2 — 如果已有 token，直接登入
    lifecycleScope.launch {
      tokenManager.token.collect { savedToken ->
        if (!savedToken.isNullOrEmpty()) {
          startActivity(Intent(this@LoginActivity, MainActivity::class.java))
          finish()
        }
      }
    }

    // 🔹 STEP 3 — Compose UI
    setContent {
      OralHealthAppTheme {
        Surface(
          modifier = Modifier.fillMaxSize(),
          color = MaterialTheme.colorScheme.background
        ) {
          LoginScreen(
            onLoginSuccess = { response ->

              val jwt = response.data.token
              ApiClient.setToken(jwt)

              lifecycleScope.launch {
                tokenManager.saveToken(jwt)
                tokenManager.saveName(response.data.name)
                tokenManager.saveEmail(response.data.email)
                tokenManager.saveProvider(response.data.provider)
              }

              startActivity(Intent(this, MainActivity::class.java))
              finish()
            },

            // ⭐ 正確 Google Login 呼叫方式
            onGoogleLogin = {
              GoogleLoginHelper.startLogin(googleLauncher)
            },

            // ⭐ LINE Web OAuth（不使用 ActivityResult）
            onLineLogin = {
              LineLoginHelper.startLogin(this)
            }
          )
        }
      }
    }
  }
}
