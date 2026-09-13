-- 执行器实例禁用标记：禁用后不参与类型解析，按名引用时明确报错
ALTER TABLE executors ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
