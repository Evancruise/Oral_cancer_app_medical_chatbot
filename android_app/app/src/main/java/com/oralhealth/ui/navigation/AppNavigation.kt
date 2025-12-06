package com.oralhealth.ui.navigation

import DiagnosisResultScreen
import DiagnosisScreen
import HomeScreen
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.oralhealth.data.local.TokenManager
import com.oralhealth.data.model.DiagnosisResponse
import com.oralhealth.ui.diagnosis.DiagnosisViewModel

@Composable
fun AppNavigation(
    tokenManager: TokenManager,
    onLogout: () -> Unit
) {
    val navController = rememberNavController()

    Scaffold(
        bottomBar = { BottomNavBar(navController) }
    ) { innerPadding ->

        NavHost(
            navController = navController,
            startDestination = "home",
            modifier = Modifier.padding(innerPadding)
        ) {

            composable("home") {
                HomeScreen(tokenManager, onLogout)
            }

            composable("appointment") {
                //AppointmentScreen()
            }

            composable("diagnosis") {
                DiagnosisScreen(
                    onFinish = { result ->
                        navController.currentBackStackEntry
                            ?.savedStateHandle
                            ?.set("diagnosis_result", result)
                        navController.navigate("result")
                    }
                )
            }

            composable("result") {
                val result = navController
                    .previousBackStackEntry
                    ?.savedStateHandle
                    ?.get<DiagnosisResponse>("diagnosis_result")
                if (result != null) DiagnosisResultScreen(result)
            }

            composable("profile") {
                //ProfileScreen(tokenManager)
            }

            composable("settings") {
                //SettingsScreen(onLogout)
            }
        }
    }
}