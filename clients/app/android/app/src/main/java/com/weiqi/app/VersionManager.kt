package com.weiqi.app

import android.content.Context
import com.weiqi.app.util.Logger
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File

/**
 * 版本管理器
 * 负责检查远程版本、读取和保存本地版本
 */
class VersionManager(
    private val context: Context,
    private val client: OkHttpClient
) {
    
    companion object {
        private const val TAG = "VersionManager"
        private val VERSION_URL: String get() = AppConfig.versionUrl
    }

    /**
     * 从远程获取版本号
     * 使用 use 自动关闭 Response
     */
    fun fetchRemoteVersion(): String {
        val request = Request.Builder()
            .url(VERSION_URL)
            .build()

        // ✅ 使用 use 自动关闭 Response
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("Failed to fetch version: ${response.code}")
            }
            val body = response.body?.string() ?: "{}"
            val json = JSONObject(body)
            json.getString("version")
        }
    }

    /**
     * 读取本地版本号
     */
    fun readLocalVersion(): String? {
        val versionFile = File(context.filesDir, "version.txt")
        return if (versionFile.exists()) {
            versionFile.readText().trim()
        } else {
            null
        }
    }

    /**
     * 保存本地版本号
     */
    fun saveLocalVersion(version: String) {
        val versionFile = File(context.filesDir, "version.txt")
        versionFile.writeText(version)
        Logger.d(TAG, "Saved version: $version")
    }
}
