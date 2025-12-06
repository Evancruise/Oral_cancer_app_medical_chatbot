package com.oralhealth.ui.line

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.oralhealth.R

@Composable
fun LineLoginButton(
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF06C755)),
        modifier = modifier
            .height(48.dp)
    ) {
        Image(
            painter = painterResource(id = R.drawable.ic_line),
            contentDescription = "LINE Logo",
            modifier = Modifier.size(20.dp)
        )
        Spacer(Modifier.width(12.dp))
        Text("Sign in with LINE", color = Color.White)
    }
}
