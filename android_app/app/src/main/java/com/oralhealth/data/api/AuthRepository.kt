package com.oralhealth.data.api

import com.oralhealth.data.api.ApiClient
import com.oralhealth.data.api.AuthApi
import com.oralhealth.data.model.*
import retrofit2.Response

class AuthRepository {

    private val api = ApiClient.retrofit.create(AuthApi::class.java)

    /** -------------------- 1️⃣ Email Login -------------------- **/
    suspend fun login(email: String, password: String): Response<LoginResponse> {
        return api.login(LoginRequest(email, password))
    }

    /** -------------------- 2️⃣ Google Login -------------------- **/
    suspend fun loginWithGoogle(req: LoginGoogleRequest): Response<LoginResponse> {
        return api.loginWithGoogle(req)
    }

    /** -------------------- 3️⃣ LINE Login -------------------- **/
    suspend fun loginWithLine(req: LoginLineRequest): Response<LoginResponse> {
        return api.loginWithLine(req)
    }
}
