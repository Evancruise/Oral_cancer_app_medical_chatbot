import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.oralhealth.data.model.DiagnosisResponse
import com.oralhealth.ui.diagnosis.DiagnosisState
import com.oralhealth.ui.diagnosis.DiagnosisViewModel

@Composable
fun DiagnosisScreen(
    vm: DiagnosisViewModel = viewModel(),
    onFinish: (DiagnosisResponse) -> Unit
) {
    val images by vm.images.observeAsState(List(8) { null })
    val state by vm.state.observeAsState(DiagnosisState.Idle)

    // 啟動相簿選取
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        vm.onImageSelected(uri)
    }

    val labels = listOf(
        "上前牙", "上左牙", "上右牙",
        "下前牙", "下左牙", "下右牙",
        "左頰側", "右頰側"
    )

    Column(Modifier.padding(16.dp)) {

        Text("口腔 8 方位拍攝", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(16.dp))

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.fillMaxHeight(0.75f)
        ) {
            items(8) { idx ->
                DiagnosisImageItem(
                    label = labels[idx],
                    imageUri = images[idx],
                    onClick = {
                        vm.currentSelectIndex = idx
                        launcher.launch("image/*")
                    }
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = { vm.startDiagnosis("1234", "notes..") }
        ) {
            Text("開始診斷")
        }

        when (state) {
            is DiagnosisState.Loading ->
                CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))

            is DiagnosisState.Success ->
                onFinish((state as DiagnosisState.Success).result)

            is DiagnosisState.Error ->
                Text(
                    text = (state as DiagnosisState.Error).msg,
                    color = Color.Red
                )

            else -> Unit
        }
    }
}