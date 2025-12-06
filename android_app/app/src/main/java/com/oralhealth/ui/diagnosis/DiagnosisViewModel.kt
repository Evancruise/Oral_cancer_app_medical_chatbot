package com.oralhealth.ui.diagnosis

import android.net.Uri
import androidx.lifecycle.*
import com.oralhealth.data.model.DiagnosisResponse
import com.oralhealth.data.model.DiagnosisResult
import com.oralhealth.data.model.QualityScore
import kotlinx.coroutines.launch

sealed class DiagnosisState {
    object Idle : DiagnosisState()
    object Loading : DiagnosisState()
    data class Success(val result: DiagnosisResponse) : DiagnosisState()
    data class Error(val msg: String) : DiagnosisState()
}

class DiagnosisViewModel : ViewModel() {

    private val _images = MutableLiveData(List<Uri?>(8) { null })
    val images: LiveData<List<Uri?>> = _images

    var currentSelectIndex = -1

    fun onImageSelected(uri: Uri?) {
        if (uri != null && currentSelectIndex >= 0) {
            val updated = _images.value!!.toMutableList()
            updated[currentSelectIndex] = uri
            _images.value = updated
        }
    }

    private val _state = MutableLiveData<DiagnosisState>(DiagnosisState.Idle)
    val state: LiveData<DiagnosisState> = _state

    fun startDiagnosis(patientId: String, notes: String) {
        _state.value = DiagnosisState.Loading

        // TODO: call your Flask/Node inference API
        viewModelScope.launch {
            val mock = DiagnosisResponse(
                message = "OK 模擬推論完成",
                diagnosis = DiagnosisResult(
                    model_version = "v1.0",
                    lesion_detected = true,
                    lesion_confidence = 0.87,
                    lesion_type = "Suspicious lesion",
                    quality_score = QualityScore(
                        alignment = 0.92,
                        distance = 0.85,
                        angle = 0.90,
                        lighting = 0.88
                    )
                )
            )
            _state.value = DiagnosisState.Success(mock)
        }
    }
}

