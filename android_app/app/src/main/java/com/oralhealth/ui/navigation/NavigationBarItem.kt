package com.oralhealth.ui.navigation

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.navigation.NavHostController
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*

@Composable
fun BottomNavBar(navController: NavHostController) {

    val items = listOf(
        BottomNavItem("home", "Home", Icons.Filled.Home),
        BottomNavItem("appointment", "Appointment", Icons.Filled.DateRange),
        BottomNavItem("diagnosis", "Diagnosis", Icons.Filled.CheckCircle),
        BottomNavItem("profile", "Profile", Icons.Filled.Person),
        BottomNavItem("settings", "Setting", Icons.Filled.Settings)
    )

    NavigationBar(
        containerColor = Color(0xFFF5F5F5)
    ) {
        val currentRoute = navController
            .currentBackStackEntryFlow
            .collectAsState(initial = navController.currentBackStackEntry)
            .value?.destination?.route

        items.forEach { item ->
            NavigationBarItem(
                selected = currentRoute == item.route,
                onClick = {
                    navController.navigate(item.route) {
                        popUpTo("home") { inclusive = false }
                        launchSingleTop = true
                    }
                },
                icon = {
                    Icon(
                        imageVector = item.icon,
                        contentDescription = item.label
                    )
                },
                label = { Text(item.label) }
            )
        }
    }
}