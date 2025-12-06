import com.oralhealth.data.model.LoginResponse

sealed class LoginState {
    object Loading : LoginState()
    data class Success(
        val data: LoginResponse,
        val provider: String   // "email" / "google" / "line"
    ) : LoginState()
    data class Error(val message: String) : LoginState()
}