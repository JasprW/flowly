#!/usr/bin/env node
// Read-only claude audit. Contract: docs/TURN-CHECKLIST-SPEC.md.
import { runAudit } from './audit-core.mjs';
runAudit('claude');
