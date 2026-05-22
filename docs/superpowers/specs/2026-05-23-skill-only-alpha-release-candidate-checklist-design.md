# Stage 37：Skill-only Alpha Release Candidate Checklist v0 Design

## 背景

Stage 30-36 已把本地单用户第一版闭环推进到可试用状态：Web/API/Skill/LP 主路径、deterministic browser gate、failure injection、provider usage metadata、普通聊天 provider token delta streaming，以及真实 provider operator smoke 文档都已完成。

当前风险不再是缺少单个底层能力，而是缺少一个 release candidate 收口入口。已有 `README.md`、`docs/web-v1-acceptance.md` 和 `docs/real-provider-alpha-smoke.md` 分别覆盖启动、人工验收和真实 provider smoke，但还没有一份文档回答：

- 什么时候可以把当前版本标记为内部 Skill-only alpha RC？
- operator 应按什么顺序做 go/no-go？
- 反馈应该怎么分类、记录和分流到后续阶段？
- 哪些限制是已知后置项，不能被误判为 RC blocker？

## 目标

- 新增 `docs/alpha-release-candidate.md`，作为 Skill-only local alpha release candidate 的 go/no-go、试用脚本、反馈模板和 triage 分类入口。
- 保持 `docs/web-v1-acceptance.md` 负责详细人工验收，`docs/real-provider-alpha-smoke.md` 负责真实 provider smoke；RC 文档只编排和决策，不复制全部步骤。
- 同步 README、manual acceptance、Superpowers index 和 roadmap，让后续 agent 选择下一阶段前看到 Stage 37 已完成。
- 保持默认 alpha gates deterministic / no-key / local-first。

## 非目标

- 不做 production auth/RBAC、真实部署编排、MCP 新功能、真实 shell runner、object storage 或 hosted observability。
- 不把内部 alpha RC 文档变成 public SaaS onboarding 或客户 SLA。
- 不改变 runtime、model gateway、worker queue、artifact workspace、LP artifact policy 或 provider adapter。
- 不新增 issue tracker 集成、反馈数据库、遥测、自动截图上传或 hosted triage board。

## 设计

### 1. RC 文档职责

`docs/alpha-release-candidate.md` 是 release readiness 的唯一入口，包含：

- RC 定义：本地、单用户、Skill-only、deterministic-first、真实 provider opt-in。
- Go/no-go gates：environment、automated deterministic gates、manual acceptance、optional real provider smoke、known limitations、feedback readiness。
- Operator trial script：一条 60-90 分钟的人工试用路径，串起普通聊天、LP task、artifact preview/export、Skills、Models boundary、failure display 和可选真实 provider。
- Feedback template：安全记录复现信息，不收集 secret、raw provider response、完整 artifact content 或本机路径。
- Triage 分类：`blocking_bug`、`ux_friction`、`provider_config_issue`、`artifact_quality_issue`、`docs_gap`、`future_feature`。
- Follow-up routing：Stage 38 处理 assistant streaming failure UX，Stage 39 处理 LP artifact quality/prompt hardening，backlog 处理生产级能力。

### 2. 入口文档一致性

- README 在文档地图和手动验收区链接 RC 文档。
- `docs/web-v1-acceptance.md` 在开头说明：它是详细验收清单；RC go/no-go 和反馈分流看 `docs/alpha-release-candidate.md`。
- `docs/real-provider-alpha-smoke.md` 在收尾处说明真实 provider 反馈按 RC 文档模板记录。

### 3. Roadmap 更新

Stage 37 完成后：

- 当前状态快照增加 RC checklist。
- Stage 37 从推荐队列移到已完成阶段记录。
- 推荐队列刷新为 Stage 38 / 39 / 40。
- Stage 40 建议为 Alpha Feedback Intake and Triage Loop v0，用于真正开始内部试用后维护反馈批次和修复计划；Stage 37 只给模板和流程。

## 验收标准

- `docs/alpha-release-candidate.md` 能独立回答 RC go/no-go、试用顺序、反馈模板、triage 分类和已知限制。
- README、manual acceptance 和真实 provider smoke 文档都能指向 RC 文档，且不互相矛盾。
- Roadmap 推荐队列不少于 3 个阶段，并明确每个阶段的范围和非目标。
- 默认验证命令仍不依赖真实 provider key、MCP、Postgres 或真实部署。
