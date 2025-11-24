package com.oralhealth

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.oralhealth.data.local.TokenManager
import com.oralhealth.ui.login.LoginActivity
import com.oralhealth.ui.theme.OralHealthAppTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var tokenManager: TokenManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        tokenManager = TokenManager(this)

        setContent {
            OralHealthAppTheme {
                Surface {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {

                        Text("Welcome!", style = MaterialTheme.typography.headlineMedium)

                        Button(
                            onClick = {
                                lifecycleScope.launch {
                                    tokenManager.clearToken()
                                    startActivity(Intent(this@MainActivity, LoginActivity::class.java))
                                    finish()
                                }
                            },
                            modifier = Modifier.padding(top = 24.dp)
                        ) {
                            Text("Logout")
                        }
                    }
                }
            }
        }
    }
}
