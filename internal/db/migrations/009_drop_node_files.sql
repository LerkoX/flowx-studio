-- 废弃 legacy：节点文件内容不再存数据库（统一走 assets store + file_assets 索引）
ALTER TABLE nodes DROP COLUMN files;
