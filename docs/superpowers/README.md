# Superpowers Documentation Index

This directory contains Superpowers-generated specs and implementation plans. Read the files in the order below when onboarding to the project or resuming work from another machine.

## Reading Order

1. `specs/2026-05-11-lp-engineering-team-agent-design.md`
   - V1 product and architecture design.
   - Read this first to understand the project goal, system boundaries, and why the monorepo is split into the current apps and packages.

2. `plans/2026-05-11-lp-engineering-team-agent-v1.md`
   - V1 implementation plan.
   - Read this after the V1 design if you need to understand how the current MVP was built.

3. `specs/2026-05-11-stage-2-agent-workflow-spec.md`
   - Stage 2 product spec.
   - Read this after the V1 design. It assumes the current MVP exists and defines the next product stage: persisted projects, skills, model routing, MCP, run timelines, agent context assembly, runtime schema validation, deployment handoff, and team collaboration primitives.

4. `specs/2026-05-12-chat-agent-workbench-ui-spec.md`
   - Stage 2 Web UI slice spec.
   - Read this after the Stage 2 product spec when working on the Manus/ChatGPT-style conversation layout, fixed sidebar, tool-call process display, artifact cards, and interrupt affordance.

5. `plans/2026-05-12-chat-agent-workbench-ui.md`
   - Stage 2 Web UI implementation plan.
   - Read this after the chat UI spec when implementing or auditing the conversation-first Web workbench.

6. `plans/2026-05-12-stage-2-persistent-repositories.md`
   - Stage 2 Milestone 1 implementation plan.
   - Read this when implementing the first Stage 2 slice: repository contracts and repository-backed workbench state.

7. `specs/2026-05-12-lightweight-real-web-project-flow-spec.md`
   - Stage 2 Milestone 2 lightweight Web flow spec.
   - Read this after the chat UI plan and repository plan when replacing the fixed demo snapshot with project creation, prompt submission, cookie-backed current project state, and process-local in-memory Web state.

8. `plans/2026-05-12-lightweight-real-web-project-flow.md`
   - Stage 2 Milestone 2 lightweight Web flow implementation plan.
   - Read this after the lightweight Web flow spec when implementing or auditing project creation, prompt submission, cookie-backed current project selection, and process-local Web state.

9. `specs/2026-05-12-web-flow-no-git-no-deployment-spec.md`
   - Stage 2 Milestone 2 scope amendment.
   - Read this after the lightweight Web flow spec and plan. It supersedes the repository URL and automatic deployment portions of the earlier lightweight Web flow documents for the current Web V1.

10. `plans/2026-05-12-web-flow-no-git-no-deployment.md`
   - Implementation plan for removing Git repository capture and automatic deployment from the current Web flow.
   - Read this after the no-Git/no-deployment spec when implementing or auditing the current project creation, prompt submission, review, static download, and preview behavior.

11. `specs/2026-05-12-conversation-first-workbench-entry-spec.md`
   - Web entry model amendment.
   - Read this after the no-Git/no-deployment plan. It supersedes the project-first Web entry for the current Web V1 and defines the Manus-style large composer, ordinary task mode, optional project context, and LP routing behavior.

12. `plans/2026-05-12-conversation-first-workbench-entry.md`
   - Implementation plan for the conversation-first Web entry.
   - Read this after the conversation-first spec when implementing or auditing the task model, deterministic routing, implicit LP project creation, general chat task rendering, large empty-state composer, and sidebar task/project behavior.

13. `specs/2026-05-13-web-workbench-persistent-state-spec.md`
   - Web workbench persistence amendment.
   - Read this after the conversation-first plan when moving Web projects, task threads, messages, and LP snapshot bindings out of process-local Web maps.

14. `plans/2026-05-13-web-workbench-persistent-state.md`
   - Implementation plan for repository-backed local Web workbench state.
   - Read this after the persistent-state spec when implementing or auditing local JSON-backed workbench state and repository-based Web task rendering.

15. `specs/2026-05-13-project-skills-management-runtime-spec.md`
   - Stage 2 Skills Management MVP spec.
   - Read this after the persistent-state plan when adding project-level skill creation, validation, publishing, project binding, and runtime context loading.

16. `plans/2026-05-13-project-skills-management-runtime.md`
   - Implementation plan for the Stage 2 Skills Management MVP.
   - Read this after the project skills spec when implementing repository-backed skill lifecycle, project binding, runtime context loading, and the Web Skills view.

17. `specs/2026-05-13-project-model-routing-config-spec.md`
   - Stage 2 Model Routing Configuration MVP spec.
   - Read this after the project skills plan when adding project-scoped model providers, planner/builder/reviewer/deployer route configuration, runtime route resolution, and Models view behavior.

18. `plans/2026-05-13-project-model-routing-config.md`
   - Implementation plan for the Stage 2 Model Routing Configuration MVP.
   - Read this after the model routing spec when implementing repository-backed project model providers, role route configuration, runtime route resolution, and the Web Models view.

19. `specs/2026-05-13-project-mcp-connector-registry-spec.md`
   - Stage 2 MCP Connector Registry MVP spec.
   - Read this after the model routing plan when adding project-scoped MCP connector definitions, tool approval state, role/permission visibility filtering, and runtime MCP context loading.

20. `plans/2026-05-13-project-mcp-connector-registry.md`
   - Implementation plan for the Stage 2 MCP Connector Registry MVP.
   - Read this after the MCP connector registry spec when implementing repository-backed connector state, approval-aware visible tools, runtime context wiring, and the Web MCP view.

21. `plans/2026-05-14-run-orchestration-context-assembly.md`
   - Stage 2 Milestone 6 implementation plan.
   - Read this after the MCP connector registry plan when implementing or auditing persisted run events, context pack assembly, runtime schema validation, and Web timeline rendering.

22. `specs/2026-05-14-provider-neutral-model-config-design.md`
   - Stage 3 model provider configuration design.
   - Read this after the run orchestration/context assembly plan when adding pi-mono-inspired but project-owned provider-neutral model configuration, API protocol selection, sanitized runtime provider metadata, and mock-chain verification before real provider adapters.

23. `plans/2026-05-14-provider-neutral-model-config.md`
   - Stage 3 provider-neutral model config implementation plan.
   - Read this after the provider-neutral model config spec when implementing generic provider API protocol selection, non-secret provider config storage, sanitized runtime metadata, Web Models controls, and mock-chain verification.

24. `specs/2026-05-14-anthropic-messages-adapter-design.md`
   - Stage 3 first real model provider adapter design.
   - Read this after the provider-neutral model config plan when adding the `anthropic-messages` model-gateway adapter for Zhipu Claude-compatible and Anthropic-compatible endpoints, fake-fetch tests, opt-in real provider verification, and secret-safe response metadata.

25. `plans/2026-05-14-anthropic-messages-adapter.md`
   - Stage 3 first real model provider adapter implementation plan.
   - Read this after the Anthropic Messages adapter spec when implementing fake-fetch unit tests, provider-backed model-gateway dispatch, opt-in real provider verification, and secret-safe adapter behavior.

26. `specs/2026-05-14-real-model-runtime-wiring-design.md`
   - Stage 3 real model runtime wiring design.
   - Read this after the Anthropic Messages adapter plan when wiring `ProviderBackedModelGateway` into Web/API/runtime behind an explicit local opt-in switch while preserving deterministic defaults and static LP artifact generation.

27. `plans/2026-05-14-real-model-runtime-wiring.md`
   - Stage 3 real model runtime wiring implementation plan.
   - Read this after the real model runtime wiring design when implementing or auditing the API-owned runtime factory, repository-backed provider resolver, explicit `REAL_MODEL_RUNTIME=1` switch, fake-fetch API tests, and sanitized run event behavior.

28. `specs/2026-05-14-openai-compatible-adapter-design.md`
   - Stage 3 OpenAI-compatible Chat Completions adapter design.
   - Read this after the real model runtime wiring plan when adding the generic `openai-completions` model-gateway adapter for Zhipu `paas/v4` and other OpenAI-compatible providers.

29. `plans/2026-05-14-openai-compatible-adapter.md`
   - Stage 3 OpenAI-compatible Chat Completions adapter implementation plan.
   - Read this after the OpenAI-compatible adapter design when implementing fake-fetch tests, the generic `openai-completions` adapter, Zhipu `paas/v4` smoke testing, runtime dispatch, and Web/API runtime coverage.

30. `specs/2026-05-14-structured-lp-brief-model-output-design.md`
   - Stage 3 structured Planner LP brief output design.
   - Read this after the OpenAI-compatible adapter plan when replacing the real-runtime Planner `sampleBrief` placeholder with validated `LPBriefSchema` parsing while keeping default deterministic behavior and static LP artifact generation.

31. `plans/2026-05-14-structured-lp-brief-model-output.md`
   - Stage 3 structured Planner LP brief output implementation plan.
   - Read this after the structured LP brief output design when implementing strict JSON Planner prompts, `LPBriefSchema` parsing, transient runtime model text, sanitized parse events, and fail-closed real-runtime behavior.

32. `specs/2026-05-14-real-builder-static-artifacts-design.md`
   - Stage 3 real Builder static artifacts design.
   - Read this after the structured LP brief output plan when replacing deterministic real-runtime Builder artifacts with model-generated, framework-free `index.html` / `styles.css` / `script.js` output guarded by strict JSON parsing and artifact policy validation.

33. `plans/2026-05-14-real-builder-static-artifacts.md`
   - Stage 3 real Builder static artifacts implementation plan.
   - Read this after the real Builder static artifacts design when implementing strict Builder artifact JSON prompts, static artifact parsing, framework/resource policy validation, sanitized Builder parse events, and fail-closed real-runtime behavior.

34. `specs/2026-05-14-skill-command-execution-design.md`
   - Stage 4 skill command execution design.
   - Read this after the real Builder static artifacts plan when adding controlled deployment skill commands, one-shot approval, command runner adapters, structured tool observations, and sanitized tool run events.

35. `plans/2026-05-14-skill-command-execution.md`
   - Stage 4 skill command execution implementation plan.
   - Read this after the skill command execution design when implementing controlled deployment skill command manifests, one-shot approval validation, command runner adapters, sanitized tool observations, and tool run events.

36. `specs/2026-05-15-skill-command-web-loop-design.md`
   - Stage 4.1 skill command Web loop design.
   - Read this after the skill command execution plan when adding the Web-facing simulated command launcher, one-shot approval UI, mock runner wiring, and sanitized timeline display.

37. `plans/2026-05-15-skill-command-web-loop.md`
   - Stage 4.1 skill command Web loop implementation plan.
   - Read this after the skill command Web loop design when implementing the safe Web command discovery, one-shot approval action, simulated runner injection, sanitized event rendering, and verification flow.

## Maintenance Rule

Whenever a Superpowers workflow creates, renames, replaces, or materially updates a spec or plan under `docs/superpowers/specs/` or `docs/superpowers/plans/`, update this index in the same change.

Each index update must keep:

- Reading order accurate.
- The short purpose of each spec or plan accurate.
- Stage and milestone relationships clear.
- References to renamed or superseded files removed or marked explicitly.

If two documents have the same date, use this index as the source of truth for order.
