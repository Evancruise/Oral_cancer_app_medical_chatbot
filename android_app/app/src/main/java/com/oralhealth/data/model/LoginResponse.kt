package com.oralhealth.data.model

data class LoginResponse(
    val success: Boolean,
    val message: String,
    val data: LoginData
)

data class LoginData(
    val token: String,
    val id: Int,
    val name: String,
    val email: String,
    val provider: String,
    val role: String
)
