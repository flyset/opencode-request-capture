# OpenCode Context Inspector

The Context Inspector is an OpenCode server plugin that captures the provider
requests sent during model inference. It records the provider-native request so
you can inspect the messages, tools, model options, and other data that
OpenCode actually sends to the model provider.

## What It Does

When enabled, the plugin:

- Intercepts outgoing provider requests without changing or blocking them.
- Associates requests with the OpenCode session ID.
- Stores one captured request per JSON file.
- Preserves structured JSON request bodies as JSON.
- Preserves non-JSON request bodies as text.
- Redacts authorization, API-key, token, cookie, and similar credential values.
- Numbers requests sequentially within each session.

The plugin is an observability tool. It does not modify prompts, tool results,
conversation history, compaction behavior, or model responses.

## Location

The server plugin entry point is:

```text
plugins/context-inspector/server.ts
```

Captured requests are written under the active OpenCode working directory:

```text
<working-directory>/.opencode/requests/<session-id>/request-<n>.json
```

Each session directory contains files such as:

```text
request-1.json
request-2.json
request-3.json
```

The session ID is read from the outgoing request metadata, using one of these
headers:

```text
x-opencode-session
x-session-affinity
session_id
```

## Enable Capture

Register the plugin with the explicit `enabled: true` option in
`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "./plugins/context-inspector/server.ts",
      {
        "enabled": true
      }
    ]
  ]
}
```

The plugin captures requests only when the option is exactly the boolean
`true`.

## Disable Capture

Keep the plugin loaded but disable capture with:

```json
{
  "plugin": [
    [
      "./plugins/context-inspector/server.ts",
      {
        "enabled": false
      }
    ]
  ]
}
```

Omitting the option also disables capture:

```json
{
  "plugin": ["./plugins/context-inspector/server.ts"]
}
```

When disabled, provider requests continue normally, but the plugin does not
read request bodies, enqueue captures, create capture directories, or write
request files. Existing request files are not deleted.

## Applying Configuration Changes

OpenCode loads plugin configuration at startup. After changing `enabled`, fully
restart OpenCode, including any separately running OpenCode server process.

## Privacy

Captured request bodies may contain prompts, source code, tool results, private
documents, and other sensitive context. Request files are stored in the active
workspace and should be treated as sensitive data.

Credential-bearing headers and recognized sensitive URL query parameters are
redacted before persistence, but body content is captured as sent. Enable the
plugin only in workspaces where this capture is appropriate.

## Current Scope

The plugin currently captures provider requests. It does not yet provide a UI
for browsing captures or calculate token counts, costs, context diffs,
provenance, duplicate content, file-state history, or compaction analysis.
