package com.oralhealth.ui.login

import android.util.Log
import androidx.lifecycle.*
import com.oralhealth.data.api.AuthRepository
import com.oralhealth.data.model.LoginRequest
import com.oralhealth.data.model.LoginResponse
import kotlinx.coroutines.launch

class LoginViewModel : ViewModel() {

    private val repository = AuthRepository()
    private val _loginResult = MutableLiveData<LoginResponse?>()
    val result: LiveData<LoginResponse?> get() = _loginResult

    private val _errorMessage = MutableLiveData<String?>()
    val errorMessage: LiveData<String?> get() = _errorMessage

    fun login(email: String, password: String) {
      viewModelScope.launch {
        try {
          val response = repository.login(LoginRequest(email, password))
          if (response.isSuccessful && response.body() != null) {
              _loginResult.postValue(response.body())
              _errorMessage.postValue(null)
          } else {
              _loginResult.postValue(null)
              _errorMessage.postValue("Login failed: ${response.message()}")
          }
        } catch (e: Exception) {
            _errorMessage.postValue("Network error: ${e.message}")
            Log.e("LoginViewModel", "Login failed", e)
        }
      }
    }
}
