# Constraint benchmark

Exit: 1; final: FAIL; cleanup: PASS.

| Model | Turn | Proactive | Final |
| --- | --- | --- | --- |
| claude-sonnet-5-5 | T1 | FAIL | FAIL |
| claude-sonnet-5-5 | T2 | UNKNOWN | UNKNOWN |
| claude-sonnet-5-5 | T3 | UNKNOWN | UNKNOWN |
| gpt-6-luna | T1 | UNKNOWN | UNKNOWN |
| gpt-6-luna | T2 | UNKNOWN | UNKNOWN |
| gpt-6-luna | T3 | UNKNOWN | UNKNOWN |

## claude-sonnet-5-5

Primary observation: not-observed

### T1

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C01.setup: proactive=UNKNOWN, final=UNKNOWN. Setup must exist before first edit
- C02.stage: proactive=UNKNOWN, final=UNKNOWN. No precise work/stage boundary
- C03.execution: proactive=UNKNOWN, final=UNKNOWN. No actual exact-command check result; runner verification is not agent execution
- C04.docs/bench-constraints-20261022150226138-4f8bce-sonnet.txt: proactive=FAIL, final=FAIL. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=FAIL, final=FAIL. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=UNKNOWN, final=FAIL. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=UNKNOWN, final=FAIL. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

### T2

UNRUN: file-missing

### T3

UNRUN: file-missing

## gpt-6-luna

Primary observation: observed

### T1

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C01.setup: proactive=UNKNOWN, final=UNKNOWN. Setup must exist before first edit
- C02.exec-fbf36a98-2a28-40e1-9557-99b506064570: proactive=PASS, final=PASS. Observed check requires test
- C03.exec-fbf36a98-2a28-40e1-9557-99b506064570: proactive=PASS, final=PASS. Compare actual command proof, SHA/dirty and stored check
- C04.docs/bench-constraints-20261022150226138-4f8bce-gpt.txt: proactive=PASS, final=PASS. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

### T2

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C02.stage: proactive=UNKNOWN, final=UNKNOWN. No precise work/stage boundary
- C03.execution: proactive=UNKNOWN, final=UNKNOWN. No actual exact-command check result; runner verification is not agent execution
- C04.outputs: proactive=N/A, final=N/A. No new deliverables expected
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal

### T3

- C01.read: proactive=UNKNOWN, final=UNKNOWN. Successful task read must precede observed work
- C02.stage: proactive=UNKNOWN, final=UNKNOWN. No precise work/stage boundary
- C03.execution: proactive=UNKNOWN, final=UNKNOWN. No actual exact-command check result; runner verification is not agent execution
- C04.https://github.com/JasprW/flowly-delivery-fixture-20261022-036d/pull/5: proactive=PASS, final=PASS. Only this-turn successful receipts linked to actual output count
- C05.delivery: proactive=PASS, final=PASS. T1/T3 overall review; T2 may use result
- C05.outputs: proactive=PASS, final=PASS. Empty artifactIds is an explicit declaration; omitted field is not
- C05.nextMoves: proactive=PASS, final=PASS. Carrying is proactive only; independent this-turn declaration satisfies final
- C06.refusal: proactive=N/A, final=N/A. No observed open-items refusal
