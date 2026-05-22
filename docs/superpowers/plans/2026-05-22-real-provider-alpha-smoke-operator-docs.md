# Stage 36：Real Provider Alpha Smoke Matrix and Operator Docs v0 实施计划

## 范围

本阶段把真实 provider alpha smoke 从 README 中的简短说明，整理成 operator-facing 的可执行文档，并补充 fake-provider regression 保护文档依赖的行为。默认 deterministic gates 保持无 key、无网络依赖。

## 任务

1. 新增 Stage 36 design/plan。
   - 新增 `docs/superpowers/specs/2026-05-22-real-provider-alpha-smoke-operator-docs-design.md`。
   - 新增本实施计划。
   - 更新 `docs/superpowers/README.md`。

2. 新增 operator smoke 文档。
   - 新增 `docs/real-provider-alpha-smoke.md`。
   - 覆盖环境变量、provider route、manual Web smoke matrix、可选 integration tests、排错和 reset deterministic。
   - 明确真实 provider key 只放 `.env.local`，Models UI 只引用 `apiKeyEnv` 名称。

3. 更新入口文档。
   - `README.md` 保留最小真实 provider smoke 路径，并链接 `docs/real-provider-alpha-smoke.md`。
   - `docs/web-v1-acceptance.md` 的可选真实 provider smoke 指向新文档。

4. 补充 fake-provider regression。
   - 在 `packages/api/src/services.test.ts` 增加 `REAL_MODEL_RUNTIME=1` OpenAI-compatible assistant streaming fake SSE 测试。
   - 增加 missing key fail-closed streaming regression。
   - 断言 run events 中只有 bounded metadata，没有 secret、env var 名称或完整 base URL。

5. 更新学习笔记和 roadmap。
   - `docs/agent-development-learning.md` 记录 Stage 36 的 provider smoke/operator docs 边界。
   - `docs/project-roadmap.md` 标记 Stage 36 完成，刷新当前状态、明确后置项和 3-5 个推荐下一阶段。

6. 验证和收尾。
   - 运行 focused tests。
   - 运行 `pnpm alpha:check`、`pnpm smoke`、`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm alpha:e2e`、`git diff --check`。
   - 合并阶段分支回 `main`，清理 worktree。

## 风险与处理

- 真实 provider 文档容易变成“默认验收”。处理：所有默认 gate 文案都保留 deterministic/no-key 描述，真实 provider smoke 标记为 opt-in。
- 文档命令容易漂移。处理：从 `.env.example` 和 integration tests 中确认变量名和命令后再写。
- Streaming failure UX 仍粗。处理：Stage 36 只记录当前 bounded behavior，把 UX hardening 留给 Stage 38。

## 完成检查

- [ ] Operator smoke 文档存在且入口链接完整。
- [ ] README/manual acceptance 与新文档一致。
- [ ] Fake-provider regression 覆盖 provider streaming usage metadata 和 missing key fail-closed。
- [ ] `docs/superpowers/README.md`、`docs/agent-development-learning.md`、`docs/project-roadmap.md` 已同步。
- [ ] 验证命令已运行并记录结果。
