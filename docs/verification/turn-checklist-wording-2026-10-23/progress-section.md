## 2026-10-23 Shared checklist wording — Fable整体复核后

- Spec先行：TURN-CHECKLIST-SPEC §2/§2.1明确现行阶段和整体交付/阶段汇报边界；只收紧shared/turn-checklist.ts第2/5项，并由既有skill-source生成仓库SKILL.md。另四项与详细规则逐字不变，6项/1583字符。
- PASS：离线3 files / 62 tests（skill-source、agent-service、tool-server）；规范/生成一致性与旧证据hash核对。保留旧benchmark原始/独立重评，不改评分。
- 未运行：B01、被测模型/审查会话、fixture/grader、全量测试、安装/reload、Git发布；未加hooks/改服务端行为/API/UI。仓库skill已生成，不宣称运行中的服务已加载新规则或模型遵守改善。无onboarding/tip/What's new改动。
- [本轮归属、检查与保留证据](verification/turn-checklist-wording-2026-10-23/report.md)。
