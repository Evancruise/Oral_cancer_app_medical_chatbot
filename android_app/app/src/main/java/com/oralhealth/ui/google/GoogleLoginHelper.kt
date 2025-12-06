package com.oralhealth.ui.google

import android.app.Activity
import android.content.Intent
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException

object GoogleLoginHelper {

    private const val TAG = "GoogleLoginHelper"

    private var googleSignInClient: GoogleSignInClient? = null

    /** 初始化 Google Sign-in */
    fun initGoogleLogin(activity: Activity, clientId: String) {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(clientId)
            .requestEmail()
            .build()

        googleSignInClient = GoogleSignIn.getClient(activity, gso)
    }

    /** 開啟 Google 登入 Flow（使用 ActivityResultLauncher） */
    fun startLogin(launcher: ActivityResultLauncher<Intent>) {
        val intent = googleSignInClient?.signInIntent
        if (intent != null) {
            launcher.launch(intent)
        } else {
            Log.e(TAG, "GoogleSignInClient is null. Did you call initGoogleLogin()?")
        }
    }

    /** 處理 Google Login 回傳結果 */
    fun handleLoginResult(
        data: Intent?,
        onSuccess: (String) -> Unit,
        onError: (String) -> Unit
    ) {
        try {
            val task = GoogleSignIn.getSignedInAccountFromIntent(data)
            val account: GoogleSignInAccount = task.getResult(ApiException::class.java)

            val idToken = account.idToken
            if (idToken != null) {
                onSuccess(idToken)
            } else {
                onError("Google token is null")
            }

        } catch (e: ApiException) {
            Log.e(TAG, "Google Login failed", e)
            onError("Google login error: ${e.message}")
        }
    }

    fun signOut(activity: Activity) {
        googleSignInClient?.signOut()
    }
}
