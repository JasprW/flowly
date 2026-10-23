# Constraint benchmark

primaryObservation=partial (1/2); Exit: 1; final: FAIL; cleanup: PASS.

| Model | Turn | Proactive | Final |
| --- | --- | --- | --- |
| claude-sonnet-5-5 | T1 | UNKNOWN | UNKNOWN |
| claude-sonnet-5-5 | T2 | UNKNOWN | UNKNOWN |
| claude-sonnet-5-5 | T3 | UNKNOWN | UNKNOWN |
| gpt-6-luna | T1 | FAIL | FAIL |
| gpt-6-luna | T2 | UNKNOWN | UNKNOWN |
| gpt-6-luna | T3 | UNKNOWN | UNKNOWN |

## claude-sonnet-5-5

Primary observation: not-observed

### T1

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C01.setup: proactive=UNKNOWN, final=UNKNOWN. Setup must exist before first edit
- C02.stage: proactive=UNKNOWN, final=UNKNOWN. No precise work/stage boundary
- C03.fixture: proactive=UNKNOWN, final=UNKNOWN. Independent script snapshot must match its creation-time frozen hash
- C03.execution: proactive=UNKNOWN, final=UNKNOWN. No actual exact-command result or independently proven same-input T3 reuse
- task.file: proactive=UNKNOWN, final=UNKNOWN. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- C04.docs/bench-constraints-20261022150226138-4f8bce-sonnet.txt: proactive=UNKNOWN, final=UNKNOWN. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=UNKNOWN, final=UNKNOWN. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=UNKNOWN, final=UNKNOWN. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=UNKNOWN, final=UNKNOWN. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal
- runtime.validity: proactive=UNKNOWN, final=UNKNOWN. Invalid execution cannot pass; independently established FAIL is retained

### T2

UNRUN: file-missing

### T3

UNRUN: file-missing

## gpt-6-luna

Primary observation: observed

### T1

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C01.setup: proactive=UNKNOWN, final=UNKNOWN. Setup must exist before first edit
- C02.exec-fbf36a98-2a28-40e1-9557-99b506064570: proactive=FAIL, final=FAIL. Observed check requires test
- C03.fixture: proactive=UNKNOWN, final=UNKNOWN. Independent script snapshot must match its creation-time frozen hash
- C03.exec-fbf36a98-2a28-40e1-9557-99b506064570: proactive=UNKNOWN, final=UNKNOWN. Actual command: return code, recorded SHA/dirty and closed inputs must agree
- task.file: proactive=PASS, final=PASS. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- C04.docs/bench-constraints-20261022150226138-4f8bce-gpt.txt: proactive=PASS, final=PASS. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

### T2

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C02.stage: proactive=UNKNOWN, final=UNKNOWN. No precise work/stage boundary
- C03.fixture: proactive=UNKNOWN, final=UNKNOWN. Independent script snapshot must match its creation-time frozen hash
- C03.execution: proactive=UNKNOWN, final=UNKNOWN. No actual exact-command result or independently proven same-input T3 reuse
- task.file: proactive=PASS, final=PASS. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- C04.outputs: proactive=N/A, final=N/A. No new deliverables expected
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

### T3

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C02.stage: proactive=UNKNOWN, final=UNKNOWN. No precise work/stage boundary
- C03.fixture: proactive=UNKNOWN, final=UNKNOWN. Independent script snapshot must match its creation-time frozen hash
- C03.execution: proactive=UNKNOWN, final=UNKNOWN. No actual exact-command result or independently proven same-input T3 reuse
- task.file: proactive=PASS, final=PASS. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- task.real-pr: proactive=PASS, final=PASS. Owned merged PR and head/merge contents must match the actual file; missing content evidence is UNKNOWN
- C04.https://github.com/JasprW/flowly-delivery-fixture-20261022-036d/pull/5: proactive=PASS, final=PASS. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal
