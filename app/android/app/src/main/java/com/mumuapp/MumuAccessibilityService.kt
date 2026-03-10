package com.mumuapp

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class MumuAccessibilityService : AccessibilityService() {

    companion object {
        var instance: MumuAccessibilityService? = null
        const val TAG = "MumuA11y"
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "MumuAccessibilityService Connected")
        MumuAccessibilityModule.sendEvent("SERVICE_CONNECTED", "true")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val source = event.source ?: return
        
        val textSequence = mutableListOf<String>()
        extractText(source, textSequence)
        
        if (textSequence.isNotEmpty()) {
            val textJoined = textSequence.joinToString("|")
            // 这里加入简单的判断，比如是否包含支付成功的关键字
            // 为了保证性能，仅当检测到可能包含交易信息的页面时通知 JS 端进行详细正则解析
            if (textJoined.contains("支付成功") || textJoined.contains("付款成功") || textJoined.contains("交易详情") || textJoined.contains("¥") || textJoined.contains("￥")) {
                Log.d(TAG, "Captured potential payment data: $textJoined")
                MumuAccessibilityModule.sendEvent("SCREEN_DATA", textJoined)
            }
        }
    }

    private fun extractText(node: AccessibilityNodeInfo, list: MutableList<String>) {
        if (node.text != null && node.text.isNotBlank()) {
            list.add(node.text.toString())
        } else if (node.contentDescription != null && node.contentDescription.isNotBlank()) {
            list.add(node.contentDescription.toString())
        }
        
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (child != null) {
                // 限制解析深度或避免死循环
                extractText(child, list)
                child.recycle()
            }
        }
    }

    override fun onInterrupt() {
        Log.d(TAG, "MumuAccessibilityService Interrupted")
        MumuAccessibilityModule.sendEvent("SERVICE_DISCONNECTED", "true")
    }
    
    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        MumuAccessibilityModule.sendEvent("SERVICE_DISCONNECTED", "true")
        return super.onUnbind(intent)
    }
}
