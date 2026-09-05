-- 节点多版本并存：name 单列唯一放宽为 (name, version) 组合唯一，空版本归一为 '0'。
-- SQLite 无法修改表级约束，需重建表；workflow_nodes 等子表的外键按名字引用 nodes，
-- rename 后自动指向新表（runner 已在迁移期间关闭外键强制检查）。
CREATE TABLE nodes_v11 (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    display_name    TEXT,
    description     TEXT,
    version         TEXT NOT NULL DEFAULT '0',
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
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    package_config  TEXT,
    file_assets     TEXT,
    UNIQUE(name, version)
);

INSERT INTO nodes_v11 (id, name, display_name, description, version, author, icon, node_type,
    language, code, entry, requirements, image, parameters, outputs, docker_config, mock_config,
    source_type, source_url, source_path, tags, created_at, updated_at, package_config, file_assets)
SELECT id, name, display_name, description, COALESCE(NULLIF(version, ''), '0'), author, icon, node_type,
    language, code, entry, requirements, image, parameters, outputs, docker_config, mock_config,
    source_type, source_url, source_path, tags, created_at, updated_at, package_config, file_assets
FROM nodes;

DROP TABLE nodes;
ALTER TABLE nodes_v11 RENAME TO nodes;

CREATE INDEX IF NOT EXISTS idx_nodes_node_type ON nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
CREATE INDEX IF NOT EXISTS idx_nodes_source_type ON nodes(source_type);
