-- 为执行节点表增加唯一约束，用于 ON CONFLICT 更新
CREATE UNIQUE INDEX IF NOT EXISTS idx_exec_nodes_unique
ON execution_nodes(execution_id, node_id);
