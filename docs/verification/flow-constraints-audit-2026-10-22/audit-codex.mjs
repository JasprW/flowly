#!/usr/bin/env node
// Read-only codex audit. Contract: docs/TURN-CHECKLIST-SPEC.md.
import { runAudit } from './audit-core.mjs';
runAudit('codex');
