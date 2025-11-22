package com.oralhealth.data.AuthRepository

import com.oralhealth.data.api.ApiClient
import com.oralhealth.data.api.AuthApi
import com.oralhealth.data.model.LoginRequest
import com.oralhealth.data.model.LoginResponse

class AuthRepository {

    private val api = ApiClient.retrofit.create(AuthApi::class.java)

    suspend fun login(account: String, password: String): LoginResponse? {
        val res = api.login(LoginRequest(account, password))
        if (res.isSuccessful) {
            val body = res.body()
            ApiClient.setToken(body?.token ?: "")
            return body
        }
        return null
    }
}