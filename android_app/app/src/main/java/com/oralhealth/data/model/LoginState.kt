import com.oralhealth.data.model.LoginResponse

sealed class LoginState {
    object Loading : LoginState()
    data class Success(val data: LoginResponse) : LoginState()
    data class Error(val message: String) : LoginState()
}