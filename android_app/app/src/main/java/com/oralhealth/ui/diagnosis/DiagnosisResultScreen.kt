import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import com.oralhealth.data.model.DiagnosisResponse
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.text.font.FontWeight

@Composable
fun DiagnosisResultScreen(result: DiagnosisResponse) {

    Column(Modifier.padding(20.dp)) {
        Text("診斷報告", style = MaterialTheme.typography.headlineMedium)

        Spacer(Modifier.height(16.dp))

        result.diagnosis?.let {
            InfoRow("模型版本", it.model_version ?: "")
            InfoRow("是否偵測病灶", if (it.lesion_detected == true) "是" else "否")
            InfoRow("信心分數", "%.2f".format(it.lesion_confidence ?: 0.0))
            InfoRow("疑似病灶種類", it.lesion_type ?: "N/A")

            Spacer(Modifier.height(12.dp))
            Text("影像品質評分", style = MaterialTheme.typography.titleMedium)

            InfoRow("對位", "%.2f".format(it.quality_score?.alignment ?: 0.0))
            InfoRow("距離", "%.2f".format(it.quality_score?.distance ?: 0.0))
            InfoRow("角度", "%.2f".format(it.quality_score?.angle ?: 0.0))
            InfoRow("光源", "%.2f".format(it.quality_score?.lighting ?: 0.0))
        }
    }
}

@Composable
fun InfoRow(key: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(key)
        Text(value, fontWeight = FontWeight.Bold)
    }
}
