package com.oralhealth.ui.login

import LoginState
import android.util.Log
import androidx.lifecycle.*
import com.oralhealth.data.api.AuthRepository
import com.oralhealth.data.model.LoginGoogleRequest
import com.oralhealth.data.model.LoginLineRequest
import com.oralhealth.data.model.LoginRequest
import com.oralhealth.data.model.LoginResponse
import kotlinx.coroutines.launch

class LoginViewModel : ViewModel() {

    private val repository = AuthRepository()

    private val _loginState = MutableLiveData<LoginState>()
    val loginState: LiveData<LoginState> get() = _loginState

    /** -------------------- 1️⃣ Email Login -------------------- **/
    fun login(email: String, password: String) {
        viewModelScope.launch {
            _loginState.value = LoginState.Loading
            try {
                val response = repository.login(email, password)

                Log.d("LoginDebug", "Token = ${response.body()?.data?.token}")

                if (response.isSuccessful && response.body()?.data?.token != null) {
                    _loginState.postValue(LoginState.Success(
                        data = response.body()!!,
                        provider = "email"
                    ))
                } else {
                    _loginState.postValue(LoginState.Error("Invalid login or empty token"))
                }
            } catch (e: Exception) {
                _loginState.postValue(LoginState.Error("Network error: ${e.message}"))
                Log.e("LoginViewModel", "Login failed", e)
            }
        }
    }

    /** -------------------- 2️⃣ Google Login Token → Server -------------------- **/
    fun loginWithGoogleToken(idToken: String) {
        viewModelScope.launch {
            _loginState.postValue(LoginState.Loading)
            try {
                val response = repository.loginWithGoogle(LoginGoogleRequest(idToken))

                if (response.isSuccessful && response.body()?.data?.token != null) {
                    _loginState.postValue(LoginState.Success(
                        response.body()!!,
                        provider = "google"
                    ))
                } else {
                    _loginState.postValue(LoginState.Error("Google login failed"))
                }

            } catch (e: Exception) {
                _loginState.postValue(LoginState.Error("Network error"))
            }
        }
    }

    /** -------------------- 3️⃣ LINE Login Token → Server -------------------- **/
    fun loginWithLineToken(lineToken: String) {
        viewModelScope.launch {
            _loginState.postValue(LoginState.Loading)
            try {
                val res = repository.loginWithLine(LoginLineRequest(lineToken))

                if (res.isSuccessful && res.body()?.data?.token != null) {
                    _loginState.postValue(LoginState.Success(
                        res.body()!!,
                        provider = "line"
                    ))
                } else {
                    _loginState.postValue(LoginState.Error("LINE login failed"))
                }

            } catch (e: Exception) {
                _loginState.postValue(LoginState.Error("Network error"))
            }
        }
    }
}