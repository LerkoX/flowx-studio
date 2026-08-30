-- 为节点表增加文件资产索引字段（节点文件内容外置到 <data.dir>/assets/nodes/，DB 只存索引）
ALTER TABLE nodes ADD COLUMN file_assets TEXT;
