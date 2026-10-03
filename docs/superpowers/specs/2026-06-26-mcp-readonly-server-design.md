# Orbit read-only MCP — current decision

Orbit exposes approved reads through an in-process FastMCP mount at `/mcp-server/mcp` on the local FastAPI sidecar.
Exposure uses a positive GET allowlist plus exclusions. No order execution, authentication, gateway/settings mutations or autonomous trading tools are exposed.
Sensitive portfolio/account reads are controlled by `MCP_EXPOSE_PORTFOLIO`, currently default-on by owner decision. The loopback trust boundary must remain intact.
AI-analysis and Inflect endpoints are retired. Tool counts must come from the current server rather than historical counts.
The mounted lifespan and packaged binary must preserve existing backend startup/shutdown behavior. Live client and packaged-runtime verification remain follow-ups in PROJECT_PLAN.md.
This document preserves the integration boundary; it does not restore removed agent skills or require an issue-board workflow.
