package com.oralhealth.data.api

import com.oralhealth.data.model.LoginGoogleRequest
import com.oralhealth.data.model.LoginLineRequest
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST
import com.oralhealth.data.model.LoginRequest
import com.oralhealth.data.model.LoginResponse

interface AuthApi {
    @POST("auth/sign-in")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>

    @POST("auth/sign-in-line")
    suspend fun loginWithLine(@Body request: LoginLineRequest): Response<LoginResponse>

    @POST("auth/google-sign-in")
    suspend fun loginWithGoogle(@Body body: LoginGoogleRequest): Response<LoginResponse>
}
