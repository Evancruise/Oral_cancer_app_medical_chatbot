package com.oralhealth.ui.login

import LoginState
import android.util.Log
import androidx.lifecycle.*
import com.oralhealth.data.api.AuthRepository
import com.oralhealth.data.model.LoginRequest
import com.oralhealth.data.model.LoginResponse
import kotlinx.coroutines.launch

class LoginViewModel : ViewModel() {

    private val repository = AuthRepository()

    private val _loginState = MutableLiveData<LoginState>()
    val loginState: LiveData<LoginState> get() = _loginState

    fun login(email: String, password: String) {
        _loginState.value = LoginState.Loading  // 🔹 顯示 loading UI

        viewModelScope.launch {
            try {
                val response = repository.login(LoginRequest(email, password))

                Log.d("LoginDebug", "Token = ${response.body()?.data?.token}")

                if (response.isSuccessful && response.body()?.data?.token != null) {
                    _loginState.postValue(LoginState.Success(response.body()!!))
                } else {
                    _loginState.postValue(LoginState.Error("Invalid login or empty token"))
                }

            } catch (e: Exception) {
                _loginState.postValue(LoginState.Error("Network error: ${e.message}"))
                Log.e("LoginViewModel", "Login failed", e)
            }
        }
    }

    fun register() {

    }
}
