package com.oralhealth.data.model

data class DiagnosisResponse(
    val message: String,
    val diagnosis: DiagnosisResult?,
)

data class DiagnosisResult(
    val model_version: String?,
    val lesion_detected: Boolean?,
    val lesion_confidence: Double?,
    val lesion_type: String?,
    val quality_score: QualityScore?
)

data class QualityScore(
    val alignment: Double?,
    val distance: Double?,
    val angle: Double?,
    val lighting: Double?
)