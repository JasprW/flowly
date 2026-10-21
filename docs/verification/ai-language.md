# AI output language: verification

Spec: [AI-LANGUAGE-SPEC](../AI-LANGUAGE-SPEC.md). Card "AI output language setting for all AI features", 2026-10-21. Code: branch `feat/ai-language`, commit `2a20531`.

## PASS

- `npm run typecheck` and `npm test` on the committed tree in a clean worktree of `origin/main` (`21aa480`): 109 files, 860 tests passed, 13 files skipped as before.
- The same patch applied to the shared main working tree (with other sessions' uncommitted work): typecheck clean, 861 tests passed, 65 skipped. `paseo plugin reload flowly`: running, no errors in `paseo plugin logs flowly`.
- Unit tests:
  - `shared/ai-language.test.ts`: the resolution chain (AI setting, interface language, reported device language, host, English), invalid values ignored, the setting defaults, and **one test per prompt builder** (summary, digest, session insights, workflow): the prompt carries the resolved language's line and none of the old wording.
  - `server/agent-service.test.ts`: `get_task` returns `outputLanguage`.
  - `client/onboarding-logic.test.ts`: tip `ai-language`.
  - `shared/i18n.test.ts`: the six new strings exist in all nine catalogs.
- **Live Workflow insights Run now on Flowly** through `workflow-insights.run` (`claude/claude-sonnet-5-5`), with the plugin reloaded on the new code. The board's cards are mostly Chinese, which is what used to decide the language.

  | `aiLanguage` | Result | Cost |
  | --- | --- | --- |
  | `en` | 8 suggestions, all English (for example "Replace inline python/node heredoc file edits with a small patch/edit helper") | $0.48 |
  | `zh-CN` | 8 suggestions, all Simplified Chinese (for example "用可复用脚本取代一次性 python3/node 内联补丁与 board.json 查询") | $0.49 |

  Each run replaced the 7 or 8 open suggestions (`replaced`). The English run shows the setting beats the material; the German run of the earlier verification cannot recur because the prompt no longer leaves the choice to the model. The setting file was removed afterwards (default again); the last run left the open suggestions in Chinese.
- Device language report: after the reload, the user's open Paseo window wrote `~/.paseo/plugin-settings/flowly/device-language.json` (`{"locale":"en"}`; the interface language is `auto`). With no AI setting stored, `flowly_get_task` then returned `outputLanguage: { code: "en", name: "English" }`, i.e. "same as interface language" resolved through the reported device language. This machine's device language is English: for Chinese output set AI output language to 简体中文.

## UNRUN

- The Settings → AI features → Output language page was not opened in a screenshot (the UI-test rules need an unambiguous non-fullscreen window). The select is the same `SettingSelect` as Interface language.
- The other three features (summary, digest, session insights) have no live run; they share `outputLanguageRule` and are covered by the per-builder unit tests.
- A phone as the reporting device (last device wins) was not tried.
