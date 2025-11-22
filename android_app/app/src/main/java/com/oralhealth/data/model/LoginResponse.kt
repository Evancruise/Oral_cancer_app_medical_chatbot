package com.oralhealth.data.model

data class LoginResponse(
    val message: String,
    val token: String,
    val role: String,
    val priority: Int,
    val name: String,
    val email: String
)
