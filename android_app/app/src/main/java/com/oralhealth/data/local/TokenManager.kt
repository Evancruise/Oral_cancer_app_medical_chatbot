package com.oralhealth.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

val Context.dataStore by preferencesDataStore(name = "user_prefs")

class TokenManager(private val context: Context) {
    companion object {
        private val TOKEN_KEY = stringPreferencesKey("token")
        private val USER_NAME = stringPreferencesKey("user_name")
        private val USER_EMAIL = stringPreferencesKey("user_email")
        private val LOGIN_PROVIDER = stringPreferencesKey("login_provider")
    }

    // Store Token
    suspend fun saveToken(token: String) {
        context.dataStore.edit { prefs ->
            prefs[TOKEN_KEY] = token
        }
    }

    suspend fun saveName(name: String) {
        context.dataStore.edit { prefs ->
            prefs[USER_NAME] = name
        }
    }

    suspend fun saveEmail(email: String) {
        context.dataStore.edit { prefs ->
            prefs[USER_EMAIL] = email
        }
    }

    suspend fun saveProvider(provider: String) {
        context.dataStore.edit { prefs ->
            prefs[LOGIN_PROVIDER] = provider
        }
    }

    // Fetch Token
    val token: Flow<String?> = context.dataStore.data.map { prefs -> prefs[TOKEN_KEY] }
    val name = context.dataStore.data.map { it[USER_NAME] ?: "" }
    val email = context.dataStore.data.map { it[USER_EMAIL] ?: "" }
    val provider = context.dataStore.data.map { it[LOGIN_PROVIDER] ?: "" }

    // Clear Token (for logout)
    suspend fun clearToken() {
        context.dataStore.edit { prefs ->
            prefs.clear()
        }
    }
}
