const test = require("node:test")
const assert = require("node:assert/strict")

const {
  WorkflowPlayer,
  WorkflowRecorder,
} = require("../dist/lib/automation/workflow-recorder.js")

test("records typed actions only inside an explicit recording session", () => {
  const recorder = new WorkflowRecorder()

  assert.throws(
    () => recorder.record({ type: "click", selector: "#submit" }),
    /recording session is not active/i,
  )

  recorder.start()
  recorder.record({ type: "click", selector: "#submit" })
  const workflow = recorder.stop()

  assert.deepEqual(workflow, {
    schemaVersion: 1,
    actions: [{ type: "click", selector: "#submit" }],
  })

  assert.throws(
    () => recorder.record({ type: "wait", milliseconds: 250 }),
    /recording session is not active/i,
  )
})

test("redacts values recorded from sensitive input selectors", () => {
  const recorder = new WorkflowRecorder()

  recorder.start()
  recorder.record({
    type: "input",
    selector: 'input[name="password"]',
    value: "correct-horse-battery-staple",
  })
  const workflow = recorder.stop()

  assert.deepEqual(workflow.actions, [
    {
      type: "input",
      selector: 'input[name="password"]',
      value: "[REDACTED]",
      redacted: true,
    },
  ])
})

test("removes credentials and sensitive query values from recorded URLs", () => {
  const recorder = new WorkflowRecorder()

  recorder.start()
  recorder.record({
    type: "navigate",
    url: "https://alice:private@example.com/report?view=list&token=top-secret",
  })
  const workflow = recorder.stop()

  assert.deepEqual(workflow.actions, [
    {
      type: "navigate",
      url: "https://example.com/report?view=list&token=%5BREDACTED%5D",
    },
  ])
})

test("pauses playback before a redacted value would be entered", async () => {
  const events = []
  const player = new WorkflowPlayer({
    navigate: async (url) => events.push(["navigate", url]),
    click: async (selector) => events.push(["click", selector]),
    input: async (selector, value) => events.push(["input", selector, value]),
    wait: async (milliseconds) => events.push(["wait", milliseconds]),
  })

  const result = await player.run({
    schemaVersion: 1,
    actions: [
      { type: "click", selector: "#open-login" },
      {
        type: "input",
        selector: 'input[name="password"]',
        value: "[REDACTED]",
        redacted: true,
      },
      { type: "click", selector: "#submit" },
    ],
  })

  assert.deepEqual(events, [["click", "#open-login"]])
  assert.deepEqual(result, {
    status: "needs-input",
    actionIndex: 1,
    selector: 'input[name="password"]',
  })
})

test("plays a reviewed workflow through the browser adapter in order", async () => {
  const events = []
  const player = new WorkflowPlayer({
    navigate: async (url) => events.push(["navigate", url]),
    click: async (selector) => events.push(["click", selector]),
    input: async (selector, value) => events.push(["input", selector, value]),
    wait: async (milliseconds) => events.push(["wait", milliseconds]),
  })

  const result = await player.run({
    schemaVersion: 1,
    actions: [
      { type: "navigate", url: "https://example.com/tasks" },
      { type: "click", selector: "#new-task" },
      { type: "input", selector: "#title", value: "Review workflow" },
      { type: "wait", milliseconds: 250 },
    ],
  })

  assert.deepEqual(events, [
    ["navigate", "https://example.com/tasks"],
    ["click", "#new-task"],
    ["input", "#title", "Review workflow"],
    ["wait", 250],
  ])
  assert.deepEqual(result, { status: "completed", actionsExecuted: 4 })
})
