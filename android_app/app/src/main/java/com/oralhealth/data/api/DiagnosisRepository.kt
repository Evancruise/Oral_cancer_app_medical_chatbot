package com.oralhealth.data.repository

import com.oralhealth.data.api.ApiClient
import com.oralhealth.data.api.DiagnosisApi
import com.oralhealth.data.model.DiagnosisResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import java.io.File

class DiagnosisRepository {
    private val api = ApiClient.retrofit.create(DiagnosisApi::class.java)

    suspend fun analyze(patientId: String, notes: String, imagePaths: List<String?>): DiagnosisResponse? {
        return withContext(Dispatchers.IO) {

            val parts = mutableListOf<MultipartBody.Part>()

            imagePaths.forEachIndexed { index, path -> 
                path?.let {
                    val file = File(it)
                    val reqFile = RequestBody.create("image/*".toMediaTypeOrNull(), file)
                    val body = MultipartBody.Part.createFormData("image", file.name, reqFile)
                    parts.add(body)
                }
            }

            val patientBody = RequestBody.create("text/plain".toMediaType(), patientId)
            val notesBody = RequestBody.create("text/plain".toMediaType(), notes)

            val res = api.analyze(patientBody, notesBody, parts)
            res.body()
        }
    }
}