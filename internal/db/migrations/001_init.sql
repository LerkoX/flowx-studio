-- 迁移版本表
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 节点注册中心
CREATE TABLE IF NOT EXISTS nodes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    display_name    TEXT,
    description     TEXT,
    version         TEXT,
    author          TEXT,
    icon            TEXT,
    node_type       TEXT NOT NULL DEFAULT 'code',
    language        TEXT,
    code            TEXT,
    entry           TEXT,
    requirements    TEXT,
    image           TEXT,
    parameters      TEXT NOT NULL DEFAULT '[]',
    outputs         TEXT DEFAULT '[]',
    docker_config   TEXT,
    mock_config     TEXT,
    source_type     TEXT DEFAULT 'manual',
    source_url      TEXT,
    source_path     TEXT,
    tags            TEXT DEFAULT '[]',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nodes_node_type ON nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
CREATE INDEX IF NOT EXISTS idx_nodes_source_type ON nodes(source_type);

-- 工作流
CREATE TABLE IF NOT EXISTS workflows (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT,
    intent          TEXT,
    yaml_config     TEXT NOT NULL,
    status          TEXT DEFAULT 'draft',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_workflows_created ON workflows(created_at);

-- 工作流节点关联
CREATE TABLE IF NOT EXISTS workflow_nodes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id     INTEGER NOT NULL,
    node_id         INTEGER NOT NULL,
    node_name       TEXT NOT NULL,
    sort_order      INTEGER DEFAULT 0,
    param_override  TEXT DEFAULT '{}',
    condition       TEXT,
    is_enabled      BOOLEAN DEFAULT 1,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE RESTRICT,
    UNIQUE(workflow_id, node_name)
);

CREATE INDEX IF NOT EXISTS idx_wf_nodes_workflow ON workflow_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_nodes_node ON workflow_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_wf_nodes_order ON workflow_nodes(workflow_id, sort_order);

-- 执行记录
CREATE TABLE IF NOT EXISTS executions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id     INTEGER NOT NULL,
    status          TEXT DEFAULT 'pending',
    trigger         TEXT DEFAULT 'manual',
    started_at      DATETIME,
    completed_at    DATETIME,
    duration_ms     INTEGER,
    result          TEXT,
    error_message   TEXT,
    error_node_id   TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_executions_workflow ON executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_created ON executions(created_at);

-- 执行节点状态
CREATE TABLE IF NOT EXISTS execution_nodes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id    INTEGER NOT NULL,
    node_id         TEXT NOT NULL,
    node_name       TEXT,
    status          TEXT DEFAULT 'pending',
    started_at      DATETIME,
    completed_at    DATETIME,
    duration_ms     INTEGER,
    output          TEXT,
    error           TEXT,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exec_nodes_execution ON execution_nodes(execution_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exec_nodes_unique ON execution_nodes(execution_id, node_id);
CREATE INDEX IF NOT EXISTS idx_exec_nodes_status ON execution_nodes(status);

-- 执行日志
CREATE TABLE IF NOT EXISTS execution_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id    INTEGER NOT NULL,
    node_id         TEXT,
    node_name       TEXT,
    step_name       TEXT,
    level           TEXT DEFAULT 'info',
    message         TEXT NOT NULL,
    output          TEXT,
    timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exec_logs_execution ON execution_logs(execution_id);
CREATE INDEX IF NOT EXISTS idx_exec_logs_node ON execution_logs(execution_id, node_id);
CREATE INDEX IF NOT EXISTS idx_exec_logs_level ON execution_logs(level);
CREATE INDEX IF NOT EXISTS idx_exec_logs_timestamp ON execution_logs(timestamp);

-- AI 配置
CREATE TABLE IF NOT EXISTS ai_configs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    provider        TEXT NOT NULL,
    name            TEXT NOT NULL,
    model           TEXT NOT NULL,
    api_key         TEXT,
    base_url        TEXT,
    temperature     REAL DEFAULT 0.7,
    max_tokens      INTEGER,
    is_active       BOOLEAN DEFAULT 0,
    is_enabled      BOOLEAN DEFAULT 1,
    capabilities    TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_configs_active ON ai_configs(is_active) WHERE is_active = 1;

-- MCP 配置
CREATE TABLE IF NOT EXISTS mcp_configs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    mode                TEXT NOT NULL DEFAULT 'local',
    command             TEXT,
    args                TEXT DEFAULT '[]',
    env                 TEXT DEFAULT '{}',
    url                 TEXT,
    auth_header_key     TEXT,
    auth_header_value   TEXT,
    is_enabled          BOOLEAN DEFAULT 1,
    status              TEXT DEFAULT 'disconnected',
    last_error          TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcp_mode ON mcp_configs(mode);
CREATE INDEX IF NOT EXISTS idx_mcp_enabled ON mcp_configs(is_enabled);

-- 系统配置
CREATE TABLE IF NOT EXISTS system_configs (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    description     TEXT,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 默认系统配置
INSERT OR IGNORE INTO system_configs (key, value, description) VALUES
('theme', 'dark', '主题: dark | light | system'),
('language', 'zh-CN', '界面语言'),
('auto_save', 'true', '是否自动保存'),
('auto_save_interval', '30', '自动保存间隔（秒）'),
('show_notifications', 'true', '是否显示通知'),
('confirm_before_delete', 'true', '删除前是否确认'),
('default_node_timeout', '300', '默认节点超时（秒）'),
('max_concurrent_executions', '5', '最大并发执行数'),
('log_retention_days', '30', '执行日志保留天数'),
('server_port', '8080', 'HTTP 服务端口'),
('mcp_command_blacklist', 'rm,rmdir,del,format,mkfs,fdisk,dd,curl,wget,nc,netcat,telnet,ssh,scp,sudo,su,chmod,chown,mount,umount,reboot,shutdown,halt,poweroff,kill,killall', 'MCP 本地命令黑名单');

-- 对话历史
CREATE TABLE IF NOT EXISTS chat_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    context_type    TEXT,
    context_id      INTEGER,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_context ON chat_history(context_type, context_id);
