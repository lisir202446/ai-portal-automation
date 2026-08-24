export type WorkflowAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "input"; selector: string; value: string; redacted?: boolean }
  | { type: "wait"; milliseconds: number }

export interface RecordedWorkflow {
  schemaVersion: 1
  actions: WorkflowAction[]
}

export interface AutomationAdapter {
  navigate(url: string): Promise<unknown>
  click(selector: string): Promise<unknown>
  input(selector: string, value: string): Promise<unknown>
  wait(milliseconds: number): Promise<unknown>
}

export type PlaybackResult =
  | { status: "completed"; actionsExecuted: number }
  | { status: "needs-input"; actionIndex: number; selector: string }

const sensitiveSelector = /password|secret|token|api[-_]?key/i

function sanitizeAction(action: WorkflowAction): WorkflowAction {
  if (action.type === "navigate") {
    const url = new URL(action.url)
    url.username = ""
    url.password = ""
    for (const key of url.searchParams.keys()) {
      if (sensitiveSelector.test(key)) {
        url.searchParams.set(key, "[REDACTED]")
      }
    }
    return { ...action, url: url.toString() }
  }
  if (action.type === "input" && sensitiveSelector.test(action.selector)) {
    return {
      ...action,
      value: "[REDACTED]",
      redacted: true,
    }
  }
  return { ...action }
}

export class WorkflowRecorder {
  private actions: WorkflowAction[] = []
  private active = false

  start(): void {
    this.actions = []
    this.active = true
  }

  record(action: WorkflowAction): void {
    if (!this.active) {
      throw new Error("Recording session is not active")
    }
    this.actions.push(sanitizeAction(action))
  }

  stop(): RecordedWorkflow {
    if (!this.active) {
      throw new Error("Recording session is not active")
    }
    this.active = false
    return {
      schemaVersion: 1,
      actions: this.actions.map((action) => ({ ...action })),
    }
  }
}

export class WorkflowPlayer {
  constructor(private readonly adapter: AutomationAdapter) {}

  async run(workflow: RecordedWorkflow): Promise<PlaybackResult> {
    for (const [actionIndex, action] of workflow.actions.entries()) {
      if (action.type === "navigate") {
        await this.adapter.navigate(action.url)
      } else if (action.type === "click") {
        await this.adapter.click(action.selector)
      } else if (action.type === "input") {
        if (action.redacted) {
          return { status: "needs-input", actionIndex, selector: action.selector }
        }
        await this.adapter.input(action.selector, action.value)
      } else {
        await this.adapter.wait(action.milliseconds)
      }
    }

    return { status: "completed", actionsExecuted: workflow.actions.length }
  }
}
