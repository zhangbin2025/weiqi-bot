package com.weiqi.app.console

import com.weiqi.app.debug.DebugBridge
import com.weiqi.app.util.Logger
import org.json.JSONObject

/**
 * ConsoleHook - JavaScript console 日志捕获
 *
 * 职责：
 * 1. 注入 JavaScript 脚本重写 console 对象
 * 2. 处理来自 JavaScript 的 console 日志
 * 3. 输出到 DebugBridge 供调试页面查看
 */
object ConsoleHook {
    
    private const val TAG = "ConsoleHook"
    
    /**
     * 注入 console hook 脚本
     * 捕获 JavaScript 的 console.log/info/warn/error 输出
     * 
     * @param evaluateJavaScript 执行 JavaScript 的回调
     */
    fun inject(evaluateJavaScript: (String) -> Unit) {
        // 使用简化版脚本，避免多行字符串问题
        val script = StringBuilder().apply {
            append("(function(){")
            append("if(window.__consoleHooked)return;")
            append("window.__consoleHooked=true;")
            append("var _log=console.log,_info=console.info,_warn=console.warn,_err=console.error,_dbg=console.debug;")
            append("function send(l,a){")
            append("var m=Array.prototype.slice.call(a).map(function(x){return typeof x==='object'?JSON.stringify(x):String(x);}).join(' ');")
            append("var s=new Error().stack||'',c='';")
            append("var ls=s.split('\\n');")
            append("for(var i=0;i<ls.length;i++){if(ls[i].indexOf('console.')===-1&&ls[i].trim()){c=ls[i].trim();break;}}")
            append("prompt('console:'+JSON.stringify({level:l,msg:m,caller:c}));")
            append("}")
            append("console.log=function(){send('LOG',arguments);_log.apply(console,arguments);};")
            append("console.info=function(){send('INFO',arguments);_info.apply(console,arguments);};")
            append("console.warn=function(){send('WARN',arguments);_warn.apply(console,arguments);};")
            append("console.error=function(){send('ERROR',arguments);_err.apply(console,arguments);};")
            append("console.debug=function(){send('DEBUG',arguments);_dbg.apply(console,arguments);};")
            append("})();")
        }.toString()
        
        evaluateJavaScript("javascript:$script")
    }
    
    /**
     * 处理 JavaScript console 日志
     * 
     * @param json 日志 JSON 字符串
     * 格式: {"level": "LOG|INFO|WARN|ERROR|DEBUG", "msg": "...", "caller": "..."}
     */
    fun handleLog(json: String) {
        try {
            val obj = JSONObject(json)
            val level = obj.optString("level", "LOG")
            val msg = obj.optString("msg", "")
            val caller = obj.optString("caller", "")
            
            // 格式: [JS] caller - msg
            val formatted = if (caller.isNotEmpty()) {
                "[JS] $caller - $msg"
            } else {
                "[JS] $msg"
            }
            
            // 输出到 DebugBridge（可在调试页面查看）
            DebugBridge.log(level, "Console", formatted)
        } catch (e: Exception) {
            Logger.e(TAG, "handleLog error", e)
        }
    }
}
