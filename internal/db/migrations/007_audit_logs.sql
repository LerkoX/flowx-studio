-- 审计日志表：记录节点/流水线/配置等写操作
CREATE TABLE IF NOT EXISTS audit_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    action        TEXT NOT NULL,        -- create_node | update_node | delete_node | import_node | mock_node | create_workflow | update_workflow | delete_workflow | run_workflow | update_config
    resource_type TEXT NOT NULL,        -- node | workflow | execution | config
    resource_id   TEXT,
    detail        TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
