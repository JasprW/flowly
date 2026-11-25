import { familyOf, type ConnectorProvider } from "../../shared/connectors";
import { azureAdapter } from "./azure";
import { confluenceAdapter } from "./confluence";
import { githubAdapter } from "./github";
import { gitlabAdapter } from "./gitlab";
import { jiraAdapter } from "./jira";
import { linearAdapter } from "./linear";
import { notionAdapter } from "./notion";
import { shortcutAdapter } from "./shortcut";
import type { ConnectorAdapter } from "./types";

const adapters = { jira: jiraAdapter, confluence: confluenceAdapter, github: githubAdapter, gitlab: gitlabAdapter, azure: azureAdapter, shortcut: shortcutAdapter, linear: linearAdapter, notion: notionAdapter } as const;

export const adapterFor = (provider: ConnectorProvider): ConnectorAdapter => adapters[familyOf(provider)];
