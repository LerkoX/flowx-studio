-- 为执行记录表增加运行时元数据字段
ALTER TABLE executions ADD COLUMN metadata_json TEXT;
