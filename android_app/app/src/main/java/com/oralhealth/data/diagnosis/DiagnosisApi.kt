package com.oralhealth.data.api

import com.oralhealth.data.model.DiagnosisResponse
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

interface DiagnosisApi {
    @Multipart
    @POST("analyze")
    suspend fun analyze(
        @Part("patient_id") patientId: RequestBody,
        @Part("notes") notes: RequestBody,
        @Part images: List<MultipartBody.Part>
    ): Response<DiagnosisResponse>
}
