-- 为执行记录表增加运行时快照 YAML（执行结束时由 flowx ExportConfig 导出，
-- 含各节点/步骤的运行时状态；续跑时据此经 LoadPipeline 恢复，不依赖进程内存）
ALTER TABLE executions ADD COLUMN runtime_yaml TEXT;
