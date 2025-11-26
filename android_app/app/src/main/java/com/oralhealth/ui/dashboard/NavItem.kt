package com.oralhealth.ui.dashboard

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.vector.ImageVector

sealed class NavItem(val route: String, val label: String, val icon: ImageVector) {
    object Home : NavItem("home", "Home", Icons.Default.Home)
    object Appointment: NavItem("appointment", "Appointment", Icons.Default.DateRange)
    object Diagnosis: NavItem("diagnosis", "Diagnosis", Icons.Default.CheckCircle)
    object Profile: NavItem("profile", "Profile", Icons.Default.Person)
    object System: NavItem("system", "System setting", Icons.Default.Settings)
}

