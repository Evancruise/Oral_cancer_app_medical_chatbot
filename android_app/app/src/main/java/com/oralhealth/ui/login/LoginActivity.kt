package com.oralhealth.ui.login

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.oralhealth.MainActivity
import com.oralhealth.data.api.ApiClient
import com.oralhealth.data.local.TokenManager
import com.oralhealth.ui.theme.OralHealthAppTheme
import kotlinx.coroutines.launch

class LoginActivity : ComponentActivity() {

  private lateinit var tokenManager: TokenManager

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    tokenManager = TokenManager(this)

    lifecycleScope.launch {
      tokenManager.token.collect { savedToken ->
        if (!savedToken.isNullOrEmpty()) {
          startActivity(Intent(this@LoginActivity, MainActivity::class.java))
          finish()
        }
      }
    }

    setContent {
      OralHealthAppTheme {
        LoginScreen(
          onLoginSuccess = { response ->
            val token = response.data.token
            ApiClient.setToken(token)

            lifecycleScope.launch {
              tokenManager.saveToken(token)
            }

            startActivity(Intent(this, MainActivity::class.java))
            finish()
          }
        )
      }
    }
  }
}

/*
class LoginActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      OralHealthAppTheme {
        Surface(
          modifier = Modifier.fillMaxSize(),
          color = MaterialTheme.colorScheme.background
        ) {
          LoginScreen(
            onLoginSuccess = { response ->
              val token = response.data.token
              ApiClient.setToken(token)
              startActivity(Intent(this, MainActivity::class.java))
            }
          )
        }
      }
    }
  }
}
*/