import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.oralhealth.ui.dashboard.NavItem

@Composable
fun DashboardNavGraph(navController: NavHostController, onLogout: () -> Unit, modifier: Modifier) {
    NavHost(navController = navController, startDestination = NavItem.Home.route) {
        composable(NavItem.Home.route) { /* DashboardScreen() */ }
        composable(NavItem.Appointment.route) { /* AppointmentScreen() */ }
        composable(NavItem.Diagnosis.route) { /* DiagnosisScreen() */}
        composable(NavItem.Profile.route) { /* ProfileScreen() */ }
        composable(NavItem.System.route) { /* SystemScreen() */ }
    }
}
