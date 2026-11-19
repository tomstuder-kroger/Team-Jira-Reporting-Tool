---
name: refresh-designer-report
description: RETIRED. Do not use this skill. The app now refreshes itself from its header button, over the Jira API or the Atlassian MCP. Only read this if you are asking why the skill was removed.
---

# Retired

This skill used to pull Jira data through the Atlassian MCP by hand and write `data-raw/` files for `npm run data:merge`. It produced `moved` lists and written notes in a format the page no longer reads, so running it would write a file the app rejects or misreads.

**To refresh the data, use the header button "Refresh from Jira", or `npm run data:jira` from a terminal.** Without a Jira API token the app runs its own read-only refresh through the Atlassian MCP (`server/mcpRefresh.mjs`). Setup, cost and troubleshooting are in `README.md`; the design is in `docs/superpowers/specs/2026-11-18-mcp-refresh-design.md`.

If a user asks you to refresh the report, do not follow the old steps. Tell them to use the button, or help them set it up from the README.

This file can be deleted.
