package com.oralhealth.ui.home

import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun HomeScreen() {
    Column(Modifier.padding(20.dp)) {
        Text("歡迎回來！", style = MaterialTheme.typography.headlineMedium)
        Text("目前已成功登入，這裡之後可接 Dashboard API")
    }
}
