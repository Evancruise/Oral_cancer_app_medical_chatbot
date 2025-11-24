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
    }

    // Store Token
    suspend fun saveToken(token: String) {
        context.dataStore.edit { prefs ->
            prefs[TOKEN_KEY] = token
        }
    }

    // Fetch Token
    val token: Flow<String?> = context.dataStore.data
        .map { prefs -> prefs[TOKEN_KEY] }

    // Clear Token (for logout)
    suspend fun clearToken() {
        context.dataStore.edit { prefs ->
            prefs.clear()
        }
    }
}
