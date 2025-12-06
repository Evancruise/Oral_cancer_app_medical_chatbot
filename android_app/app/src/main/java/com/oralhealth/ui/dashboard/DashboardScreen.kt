package com.oralhealth.ui.home

import DashboardNavGraph
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.collectAsState
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.oralhealth.data.local.TokenManager
import com.oralhealth.ui.dashboard.NavItem

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    tokenManager: TokenManager,
    onLogout: () -> Unit
) {
    val navController = rememberNavController()
    val name by tokenManager.name.collectAsState(initial = "")
    val email by tokenManager.email.collectAsState(initial = "")
    val provider by tokenManager.provider.collectAsState(initial = "")

    val items = listOf(
        NavItem.Home,
        NavItem.Appointment,
        NavItem.Diagnosis,
        NavItem.Profile,
        NavItem.System
    )

    Column(
        modifier = Modifier.padding(24.dp)
    ) {
        Text("Welcome, $name", style = MaterialTheme.typography.headlineMedium)
        Text("Email: $email", style = MaterialTheme.typography.bodyLarge)
        Text("Login Provider: $provider", style = MaterialTheme.typography.bodyLarge)

        Spacer(modifier = Modifier.height(24.dp))

        when (provider) {
            "google" -> Text("You logged in with Google 🌐")
            "line" -> Text("You logged in with LINE 💚")
            "email" -> Text("You logged in with Email ✉️")
        }
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentRoute = navBackStackEntry?.destination?.route

                items.forEach { item ->
                    NavigationBarItem(
                        selected = currentRoute == item.route,
                        onClick = { navController.navigate(item.route) },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) }
                    )
                }
            }
        }
    ) { padding ->
        DashboardNavGraph(
            navController = navController,
            onLogout = onLogout,
            modifier = Modifier.padding(padding)
        )
    }
}
