# FlowX Studio 技术设计文档

## 项目说明

**FlowX Studio** 是一个基于 [FlowX](https://github.com/LerkoX/flowx) 核心引擎构建的 AI 驱动可视化工作流平台。FlowX Studio 作为独立项目/仓库，通过 Go Module 引入 FlowX 核心库，在其之上构建 Web UI、AI 对话、节点注册中心等能力。

**仓库关系**：
- `github.com/LerkoX/flowx` —— FlowX 核心引擎（DAG 执行、多后端执行器、模板引擎）
- `github.com/LerkoX/flowx-studio` —— AI 可视化工作流平台（本文档描述的项目）

## 文档索引

| 章节 | 文件 | 内容 |
|------|------|------|
| 1 | [01-overview.md](./01-overview.md) | 项目概述、愿景与核心原则 |
| 2 | [02-architecture.md](./02-architecture.md) | 系统整体架构、模块划分与交互关系 |
| 3 | [03-database.md](./03-database.md) | SQLite 数据库 Schema 设计 |
| 4 | [04-api.md](./04-api.md) | REST API 接口设计规范 |
| 5 | [05-frontend.md](./05-frontend.md) | React 前端架构、组件设计与状态管理 |
| 6 | [06-ai-service.md](./06-ai-service.md) | AI 集成（SKILL + CLI）：技能文件 + CLI 客户端渐进式披露 |
| 7 | [07-node-system.md](./07-node-system.md) | 节点注册中心、Mock 模式与执行引擎 |
| 8 | [08-runtime.md](./08-runtime.md) | 运行时架构、单二进制部署、核心库依赖与接口评估 |
| 9 | [09-security.md](./09-security.md) | 安全设计、错误处理与日志规范 |
| 10 | [10-core-deps.md](./10-core-deps.md) | FlowX 核心库依赖评估与增强建议 |
| 11 | [11-node-package.md](./11-node-package.md) | 节点包规范（flowx.json）与导入执行映射 |
| 📋 | [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) | **实现状态跟踪：已完成功能 vs 待实现功能** |

## 设计原则

1. **零人工配置**：用户仅通过自然语言描述需求，AI 完成所有实现和编排
2. **单二进制部署**：`flowx-studio` 一个命令启动完整平台
3. **本地化优先**：数据存储在本地 SQLite，支持离线运行
4. **引擎复用**：最大化复用现有 FlowX DAG 引擎能力，不重复造轮子
5. **多模型兼容**：支持 OpenAI、Anthropic、Ollama 等多种 AI 提供商
6. **独立演进**：FlowX Studio 与 FlowX 核心库解耦，各自独立版本迭代
