import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import com.oralhealth.data.local.TokenManager

/*
@Composable
fun HomeScreen(
    userName: String = "admin",
    onDiagnosisClick: () -> Unit,
    onAppointmentClick: () -> Unit,
    onRecordsClick: () -> Unit,
    onReportClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp)
    ) {
        // ----------- Header -------------
        Text (
            text = "Hi, $userName",
            style = MaterialTheme.typography.bodyMedium,
            color = Color.Gray,
            modifier = Modifier.padding(bottom = 24.dp)
        )

        // ----------- Quick Actions ----------
        Text (
            text = "Quick Actions",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(bottom = 12.dp)
        )

        Row (Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            HomeActionCard("AI Diagnosis", "") { onDiagnosisClick() }
            HomeActionCard("Appointment", "") { onAppointmentClick() }
        }

        Row (Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            HomeActionCard("Medical Records", "") { onRecordsClick() }
            HomeActionCard("Health Report", "") { onReportClick() }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // ---------- Today's information ----------
        Text (
            text = "Today's Summary",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(bottom = 12.dp)
        )

        Card (
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFF2F2F7)),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("You have no appointments today.", color = Color.Gray)

                Spacer(Modifier.height(8.dp))

                Text("Last diagnosis: Normal", color = Color.Gray)
            }
        }
    }
}

@Composable
fun HomeActionCard(title: String, icon: String, onClick: () -> Unit) {
    Card (
        modifier = Modifier
            .width(150.dp)
            .height(120.dp)
            .clickable { onClick() },
        elevation = CardDefaults.cardElevation(4.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(icon, fontSize = 32.sp)
            Spacer(Modifier.height(8.dp))
            Text(title, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
*/

@Composable
fun HomeScreen(
    tokenManager: TokenManager,
    onLogout: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp)
    ) {

        Text(
            text = "Welcome to Oral Health AI",
            style = MaterialTheme.typography.headlineSmall
        )

        Spacer(Modifier.height(16.dp))

        // 今日概要卡片
        Card(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp)
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("今日概要", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text("📌 今日沒有新的診斷任務")
                Text("📅 下次預約：無")
            }
        }

        // 快速入口（Diagnosis, Appointment, Profile）
        Spacer(Modifier.height(16.dp))

        Text("快速功能", style = MaterialTheme.typography.titleMedium)

        Spacer(Modifier.height(8.dp))

        Row(Modifier.fillMaxWidth()) {
            HomeQuickButton("開始診斷")
            HomeQuickButton("預約紀錄")
            HomeQuickButton("我的帳號")
        }

        Button(onClick = onLogout) {
            Text("Logout")
        }
    }
}

@Composable
fun HomeQuickButton(label: String) {
    Card(
        modifier = Modifier
            .padding(8.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFECEAFF))
    ) {
        Box(
            modifier = Modifier
                .height(90.dp)
                .fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            Text(label)
        }
    }
}
