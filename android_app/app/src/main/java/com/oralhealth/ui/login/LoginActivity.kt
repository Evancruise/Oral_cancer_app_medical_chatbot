package com.oralhealth.ui.login

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import com.oralhealth.MainActivity
import com.oralhealth.data.api.ApiClient
import com.oralhealth.ui.theme.OralHealthAppTheme

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