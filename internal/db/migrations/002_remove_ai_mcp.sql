-- 移除 AI / 外部 MCP 相关表

DROP TABLE IF EXISTS ai_configs;
DROP TABLE IF EXISTS chat_history;
DROP TABLE IF EXISTS mcp_configs;

-- 清理 system_configs 中不再需要的 MCP 相关默认值
DELETE FROM system_configs WHERE key = 'mcp_command_blacklist';
