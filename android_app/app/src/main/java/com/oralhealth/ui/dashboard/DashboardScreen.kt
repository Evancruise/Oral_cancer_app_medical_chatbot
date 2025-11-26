package com.oralhealth.ui.home

import DashboardNavGraph
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.oralhealth.ui.dashboard.NavItem

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    onLogout: () -> Unit
) {
    val navController = rememberNavController()
    val items = listOf(
        NavItem.Home,
        NavItem.Appointment,
        NavItem.Diagnosis,
        NavItem.Profile,
        NavItem.System
    )

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
