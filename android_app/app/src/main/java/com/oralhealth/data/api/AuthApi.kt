package com.oralhealth.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST
import com.oralhealth.data.model.LoginRequest
import com.oralhealth.data.model.LoginResponse

interface AuthApi {
    @POST("auth/sign-in")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>
}
