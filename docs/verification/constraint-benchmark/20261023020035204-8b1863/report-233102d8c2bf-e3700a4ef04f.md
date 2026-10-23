# Constraint benchmark

primaryObservation=observed (2/2); Exit: 1; final: FAIL; cleanup: FAIL.

| Model | Turn | Proactive | Final |
| --- | --- | --- | --- |
| claude-sonnet-5-5 | T1 | UNKNOWN | UNKNOWN |
| claude-sonnet-5-5 | T2 | FAIL | FAIL |
| claude-sonnet-5-5 | T3 | UNKNOWN | UNKNOWN |
| gpt-6-luna | T1 | FAIL | FAIL |
| gpt-6-luna | T2 | PASS | PASS |
| gpt-6-luna | T3 | FAIL | FAIL |

## claude-sonnet-5-5

Primary observation: observed

### T1

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C01.setup: proactive=UNKNOWN, final=UNKNOWN. Setup must exist before first edit
- C02.stage: proactive=UNKNOWN, final=UNKNOWN. No precise work/stage boundary
- C03.fixture: proactive=PASS, final=PASS. Independent script snapshot must match its creation-time frozen hash
- C03.execution: proactive=UNKNOWN, final=UNKNOWN. No actual exact-command result or independently proven same-input T3 reuse
- task.file: proactive=PASS, final=PASS. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- C04.docs/bench-constraints-20261023020035204-8b1863-sonnet.txt: proactive=PASS, final=PASS. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

### T2

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C02.stage: proactive=UNKNOWN, final=UNKNOWN. No precise work/stage boundary
- C03.fixture: proactive=PASS, final=PASS. Independent script snapshot must match its creation-time frozen hash
- C03.execution: proactive=UNKNOWN, final=UNKNOWN. No actual exact-command result or independently proven same-input T3 reuse
- task.file: proactive=PASS, final=PASS. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- C04.outputs: proactive=N/A, final=N/A. No new deliverables expected
- C05.delivery: proactive=FAIL, final=FAIL. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=UNKNOWN, final=FAIL. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=UNKNOWN, final=FAIL. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

### T3

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C02.stage: proactive=UNKNOWN, final=UNKNOWN. No precise work/stage boundary
- C03.fixture: proactive=PASS, final=PASS. Independent script snapshot must match its creation-time frozen hash
- C03.execution: proactive=UNKNOWN, final=UNKNOWN. No actual exact-command result or independently proven same-input T3 reuse
- task.file: proactive=PASS, final=PASS. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- task.real-pr: proactive=PASS, final=PASS. Owned merged PR and head/merge contents must match the actual file; missing content evidence is UNKNOWN
- C04.https://github.com/JasprW/flowly-delivery-fixture-20261022-036d/pull/6: proactive=PASS, final=PASS. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

## gpt-6-luna

Primary observation: observed

### T1

- C01.read: proactive=PASS, final=PASS. Successful task read must precede observed work
- C01.setup: proactive=UNKNOWN, final=UNKNOWN. Setup must exist before first edit
- C02.exec-ab150483-6504-4de3-8913-a21864a2d378: proactive=PASS, final=PASS. Observed edit requires development
- C02.exec-8e3488b4-75fa-48d3-99e4-1d8d7b26224f: proactive=FAIL, final=FAIL. Observed check requires test
- C03.fixture: proactive=PASS, final=PASS. Independent script snapshot must match its creation-time frozen hash
- C03.exec-8e3488b4-75fa-48d3-99e4-1d8d7b26224f: proactive=PASS, final=PASS. Actual command: return code, recorded SHA/dirty and closed inputs must agree
- task.file: proactive=PASS, final=PASS. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- C04.docs/bench-constraints-20261023020035204-8b1863-gpt.txt: proactive=PASS, final=PASS. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=FAIL, final=FAIL. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=UNKNOWN, final=FAIL. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

### T2

- C01.read: proactive=PASS, final=PASS. Successful task read must precede observed work
- C02.exec-b82bd501-d9ed-4de7-8925-4bc929143c5c: proactive=PASS, final=PASS. Observed check requires test
- C03.fixture: proactive=PASS, final=PASS. Independent script snapshot must match its creation-time frozen hash
- C03.exec-b82bd501-d9ed-4de7-8925-4bc929143c5c: proactive=PASS, final=PASS. Actual command: return code, recorded SHA/dirty and closed inputs must agree
- task.file: proactive=PASS, final=PASS. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- C04.outputs: proactive=N/A, final=N/A. No new deliverables expected
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

### T3

- C01.read: proactive=PASS, final=PASS. Successful task read must precede observed work
- C02.exec-a9ef0be0-389d-4c39-803b-15f996cc94a7: proactive=PASS, final=PASS. Observed check requires test
- C03.fixture: proactive=PASS, final=PASS. Independent script snapshot must match its creation-time frozen hash
- C03.exec-a9ef0be0-389d-4c39-803b-15f996cc94a7: proactive=PASS, final=PASS. Actual command: return code, recorded SHA/dirty and closed inputs must agree
- task.file: proactive=PASS, final=PASS. The requested file must actually contain text; environment interruption is not an incomplete-task violation
- task.scope: proactive=FAIL, final=FAIL. Observed changes outside the single allowed file
- task.real-pr: proactive=PASS, final=PASS. Owned merged PR and head/merge contents must match the actual file; missing content evidence is UNKNOWN
- C04.https://github.com/JasprW/flowly-delivery-fixture-20261022-036d/pull/7: proactive=PASS, final=PASS. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal
