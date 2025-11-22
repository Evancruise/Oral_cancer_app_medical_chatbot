package com.oralhealth.data.api

import retrofit2.Response
import com.oralhealth.data.model.LoginRequest
import com.oralhealth.data.model.LoginResponse

class AuthRepository {
    private val api = ApiClient.retrofit.create(AuthApi::class.java)

    suspend fun login(request: LoginRequest): Response<LoginResponse> {
        return api.login(request)
    }
}