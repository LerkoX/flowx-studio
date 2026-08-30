-- 执行器实例表：命名执行器配置（local 单例，docker 可多实例）
CREATE TABLE IF NOT EXISTS executors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,           -- 实例名（如 local / docker-gpu）
    type        TEXT NOT NULL,                  -- local | docker（k8s 暂不支持）
    description TEXT,
    config      TEXT NOT NULL DEFAULT '{}',     -- JSON，透传给 FlowX executor adapter
    is_default  INTEGER NOT NULL DEFAULT 0,     -- 全局唯一默认执行器
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- local 单例约束：全表最多一条 type='local'
CREATE UNIQUE INDEX IF NOT EXISTS idx_executors_local_singleton ON executors(type) WHERE type = 'local';
-- 默认执行器全局唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_executors_default ON executors(is_default) WHERE is_default = 1;

-- 播种默认 local 执行器，保证"默认执行器"始终存在
INSERT INTO executors (name, type, description, config, is_default)
SELECT 'local', 'local', '本机 Shell 执行器（默认）', '{}', 1
WHERE NOT EXISTS (SELECT 1 FROM executors WHERE type = 'local');
