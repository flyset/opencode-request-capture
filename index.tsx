/** @jsxImportSource @opentui/solid */

import { useTerminalDimensions } from "@opentui/solid"
import type { KeyEvent, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { onCleanup, onMount } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

const INFERENCE_ROUTE = "context-inspector.inference"

type InferenceViewProps = {
  api: TuiPluginApi
  turnIndex: number
  inferenceIndex: number
  content: string
  accentColor: RGBA
  borderColor: RGBA
  textColor: RGBA
  mutedColor: RGBA
  onBack: () => void
}

async function copyToClipboard(content: string) {
  const runtime = globalThis as typeof globalThis & {
    process?: { platform: string; env: Record<string, string | undefined> }
    Bun?: {
      spawn: (
        command: string[],
        options: { stdin: Uint8Array; stdout: "ignore"; stderr: "pipe" },
      ) => { exited: Promise<number> }
    }
  }
  if (!runtime.Bun || !runtime.process) throw new Error("Clipboard copying requires the Bun runtime.")

  const command =
    runtime.process.platform === "darwin"
      ? ["pbcopy"]
      : runtime.process.platform === "win32"
        ? ["clip.exe"]
        : runtime.process.env.WAYLAND_DISPLAY
          ? ["wl-copy"]
          : ["xclip", "-selection", "clipboard"]

  const child = runtime.Bun.spawn(command, {
    stdin: new TextEncoder().encode(content),
    stdout: "ignore",
    stderr: "pipe",
  })
  if ((await child.exited) !== 0) throw new Error("The system clipboard command failed.")
}

function InferenceView(props: InferenceViewProps) {
  const dimensions = useTerminalDimensions()
  let scrollbox: ScrollBoxRenderable | undefined

  onMount(() => {
    const keyInput = props.api.renderer.keyInput as unknown as {
      prependListener: (event: "keypress", listener: (key: KeyEvent) => void) => void
      removeListener: (event: "keypress", listener: (key: KeyEvent) => void) => void
    }
    const onKeyPress = (key: KeyEvent) => {
      if (key.ctrl && key.name === "y") {
        void copyToClipboard(props.content).then(
          () => props.api.ui.toast({ message: "Inference content copied to clipboard." }),
          (error) => props.api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) }),
        )
        key.stopPropagation()
        return
      }

      if (!scrollbox) return

      switch (key.name) {
        case "up":
          scrollbox.scrollBy(-1 / 5, "viewport")
          break
        case "down":
          scrollbox.scrollBy(1 / 5, "viewport")
          break
        case "left":
          scrollbox.scrollBy({ x: -1 / 5 * scrollbox.viewport.width, y: 0 })
          break
        case "right":
          scrollbox.scrollBy({ x: 1 / 5 * scrollbox.viewport.width, y: 0 })
          break
        case "pageup":
          scrollbox.scrollBy(-1 / 2, "viewport")
          break
        case "pagedown":
          scrollbox.scrollBy(1 / 2, "viewport")
          break
        case "home":
          scrollbox.scrollTo({ x: 0, y: 0 })
          break
        case "end":
          scrollbox.scrollTo({ x: scrollbox.scrollWidth, y: scrollbox.scrollHeight })
          break
        case "escape":
          props.onBack()
          break
        default:
          return
      }

      key.stopPropagation()
    }

    keyInput.prependListener("keypress", onKeyPress)
    onCleanup(() => keyInput.removeListener("keypress", onKeyPress))
  })

  return (
    <box width="100%" height="100%" flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={props.textColor}>
          <b>
            <span style={{ fg: props.accentColor }}>Context Inspector</span> / Turn {props.turnIndex + 1} / Inference {props.inferenceIndex + 1}
          </b>
        </text>
        <text fg={props.mutedColor}>Esc back</text>
      </box>
      <scrollbox
        ref={(value: ScrollBoxRenderable) => {
          scrollbox = value
          setTimeout(() => scrollbox?.focus(), 1)
        }}
        flexGrow={1}
        minHeight={0}
        scrollX
        scrollY
        border
        borderColor={props.borderColor}
      >
        <text wrapMode="none" fg={props.textColor}>
          {props.content}
        </text>
      </scrollbox>
      <text flexShrink={0} fg={props.mutedColor}>
        Ctrl+Y copy all. Arrows scroll, Page Up/Down page, Home/End jump, or use the mouse wheel.
      </text>
    </box>
  )
}

function inferenceContent(api: TuiPluginApi, sessionID: string, messageID: string, partIndex: number) {
  const messages = api.state.session.messages(sessionID)
  const inference = messages.find((message) => message.id === messageID)
  if (!inference || inference.role !== "assistant") return

  const currentParts = api.state.part(inference.id)
  const context = messages.slice(0, messages.findIndex((message) => message.id === inference.id)).map((message) => ({
    message,
    parts: api.state.part(message.id),
  }))
  const partsBeforeInference = currentParts.slice(0, partIndex)
  if (partsBeforeInference.length > 0) {
    context.push({ message: inference, parts: partsBeforeInference })
  }

  return JSON.stringify(
    {
      inference,
      step: currentParts[partIndex],
      context,
    },
    null,
    2,
  )
}

const ContextInspector: TuiPlugin = async (api) => {
  const unregisterRoute = api.route.register([
    {
      name: INFERENCE_ROUTE,
      render: ({ params }) => {
        const sessionID = params?.sessionID
        const messageID = params?.messageID
        const partIndex = params?.partIndex
        const turnIndex = params?.turnIndex
        const inferenceIndex = params?.inferenceIndex

        if (
          typeof sessionID !== "string" ||
          typeof messageID !== "string" ||
          typeof partIndex !== "number" ||
          typeof turnIndex !== "number" ||
          typeof inferenceIndex !== "number"
        ) {
          return <text fg={api.theme.current.error}>Invalid inference route.</text>
        }

        const content = inferenceContent(api, sessionID, messageID, partIndex)
        if (!content) return <text fg={api.theme.current.error}>The selected inference is no longer available.</text>

        return (
          <InferenceView
            api={api}
            turnIndex={turnIndex}
            inferenceIndex={inferenceIndex}
            content={content}
            accentColor={api.theme.current.accent}
            borderColor={api.theme.current.border}
            textColor={api.theme.current.text}
            mutedColor={api.theme.current.textMuted}
            onBack={() => api.route.navigate("session", { sessionID })}
          />
        )
      },
    },
  ])

  const unregister = api.command?.register(() => [
    {
      title: "Inspect",
      value: "inspect",
      description: "Browse captured context turns.",
      category: "Context Inspector",
      slash: { name: "inspect" },
      onSelect: (dialog) => {
        const stack = dialog ?? api.ui.dialog
        const sessionID =
          api.route.current.name === "session" && typeof api.route.current.params.sessionID === "string"
            ? api.route.current.params.sessionID
            : undefined
        const turns = sessionID ? api.state.session.messages(sessionID).filter((message) => message.role === "user") : []

        stack.replace(() =>
          api.ui.DialogSelect({
            title: "Turns",
            placeholder: "No turns are available.",
            options: turns.map((turn, index) => ({
              title: `Turn ${index + 1}`,
              value: turn.id,
              onSelect: () => {
                const messages = sessionID ? api.state.session.messages(sessionID) : []
                const inferences = messages.flatMap((message) => {
                  if (message.role !== "assistant" || message.parentID !== turn.id) return []

                  const parts = api.state.part(message.id)
                  const steps = parts.flatMap((part, partIndex) =>
                    part.type === "step-start" ? [{ message, part, partIndex }] : [],
                  )

                  // Older stored messages may not have step markers. Treat the
                  // complete assistant message as one legacy inference.
                  return steps.length > 0 ? steps : [{ message, part: undefined, partIndex: parts.length }]
                })

                stack.replace(() =>
                  api.ui.DialogSelect({
                    title: `Turn ${index + 1}`,
                    placeholder: "No inferences are available.",
                    options: inferences.map((inference, inferenceIndex) => ({
                      title: `Inference ${inferenceIndex + 1}`,
                      value: `${inference.message.id}:${inference.partIndex}`,
                      onSelect: () => {
                        stack.clear()
                        api.route.navigate(INFERENCE_ROUTE, {
                          sessionID,
                          messageID: inference.message.id,
                          partIndex: inference.partIndex,
                          turnIndex: index,
                          inferenceIndex,
                        })
                      },
                    })),
                  }),
                )
              },
            })),
          }),
        )
      },
    },
  ])

  if (unregister) api.lifecycle.onDispose(unregister)
  api.lifecycle.onDispose(unregisterRoute)
}

export default {
  id: "opencode-context-inspector",
  tui: ContextInspector,
} satisfies TuiPluginModule
