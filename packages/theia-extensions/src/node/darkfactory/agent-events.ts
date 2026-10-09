import { basename } from "node:path";
import { isGenuinePrompt } from "./transcript-parser.js";
import {
  PANE_DIFF_LINES,
  PANE_PROSE_BLOCKS,
  type AgentPaneDelta,
  type AgentPaneSnapshot,
  type PaneDiff,
  type PanePlanItem,
  type PanePlanSource,
  type PaneTool,
} from "../../common/agent-pane-protocol.js";
import type { AgentState } from "../../common/darkfactory-protocol.js";

/**
 * One transcript line, as loosely as Claude Code's undocumented JSONL allows:
 * every property may be absent, and nothing here throws on a shape it does not
 * know.
 */
export interface PaneEntry {
  type?: string;
  timestamp?: string;
  isMeta?: boolean;
  permissionMode?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: unknown;
    usage?: { output_tokens?: unknown };
  };
  toolUseResult?: unknown;
}

export interface PaneInputs {
  sessionId: string;
  title?: string;
  state?: AgentState;
  needsYou?: boolean;
  /** The last of the plan chain, read by the caller from a spec's `_plan.md`. */
  fallbackPlan?: readonly PanePlanItem[];
}

/** Tools whose calls are the plan, not work: kept out of the turn's tool list. */
const PLAN_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "ExitPlanMode"]);

const VERBS: Record<string, string> = {
  Read: "Read",
  Edit: "Edit",
  MultiEdit: "Edit",
  Write: "Write",
  NotebookEdit: "Edit",
  Bash: "Run",
  Grep: "Search",
  Glob: "Find",
  Task: "Delegate",
  Agent: "Delegate",
  WebFetch: "Fetch",
  WebSearch: "Search web",
};

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const blocksOf = (e: PaneEntry): Array<Record<string, unknown>> =>
  Array.isArray(e.message?.content) ? (e.message!.content as unknown[]).map(asRecord).filter((b): b is Record<string, unknown> => !!b) : [];
const timeOf = (e: PaneEntry | undefined): number | undefined => {
  const ms = e?.timestamp ? Date.parse(e.timestamp) : NaN;
  return Number.isNaN(ms) ? undefined : ms;
};
const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** A tool call and, once it came back, its answer. */
interface Call {
  id: string;
  name: string;
  input: Record<string, unknown>;
  at?: number;
  /** Index of the entry holding the call, in the whole transcript. */
  index: number;
  result?: { at?: number; isError: boolean; text: string; extra: unknown; index: number };
}

/** Every tool call of the transcript in call order, each paired with its result by id. */
function pairCalls(entries: readonly PaneEntry[]): Call[] {
  const calls: Call[] = [];
  const byId = new Map<string, Call>();
  entries.forEach((e, index) => {
    const role = e.message?.role;
    if (role === "assistant") {
      for (const b of blocksOf(e)) {
        const id = asString(b["id"]);
        const name = asString(b["name"]);
        if (b["type"] !== "tool_use" || !id || !name || byId.has(id)) continue;
        const call: Call = { id, name, input: asRecord(b["input"]) ?? {}, index, ...(timeOf(e) !== undefined ? { at: timeOf(e)! } : {}) };
        byId.set(id, call);
        calls.push(call);
      }
    } else if (role === "user") {
      for (const b of blocksOf(e)) {
        const id = asString(b["tool_use_id"]);
        const call = id ? byId.get(id) : undefined;
        if (b["type"] !== "tool_result" || !call) continue;
        const content = b["content"];
        const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => asString(asRecord(c)?.["text"]) ?? "").join(" ") : "";
        call.result = { isError: b["is_error"] === true, text, extra: e.toolUseResult, index, ...(timeOf(e) !== undefined ? { at: timeOf(e)! } : {}) };
      }
    }
  });
  return calls;
}

/** The text of a genuine user prompt, or undefined for a tool result, meta line or injected text. */
function promptText(e: PaneEntry): string | undefined {
  const m = e.message;
  if (m?.role !== "user") return undefined;
  if (Array.isArray(m.content) && m.content.some((b) => asRecord(b)?.["type"] === "tool_result")) return undefined;
  const text = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((b) => asString(asRecord(b)?.["text"])).find((t) => t !== undefined) : undefined;
  return text !== undefined && isGenuinePrompt(e.isMeta === true, text) ? collapse(text) : undefined;
}

/** The target a verb acts on: a file's name, a command's first line, a pattern. */
function targetOf(call: Call): string | undefined {
  const i = call.input;
  if (call.name === "Bash") {
    const cmd = asString(i["command"])?.trim().split("\n")[0];
    return cmd ? cmd.slice(0, 160) : undefined;
  }
  const file = asString(i["file_path"]) ?? asString(i["notebook_path"]);
  if (file) return basename(file);
  const other = asString(i["pattern"]) ?? asString(i["url"]) ?? asString(i["query"]) ?? asString(i["description"]) ?? asString(i["path"]);
  return other ? other.slice(0, 160) : undefined;
}

/** Lines of a `structuredPatch`, flattened; empty when the result has none. */
function patchLines(extra: unknown): string[] {
  const patch = asRecord(extra)?.["structuredPatch"];
  if (!Array.isArray(patch)) return [];
  return patch.flatMap((h) => {
    const lines = asRecord(h)?.["lines"];
    return Array.isArray(lines) ? lines.filter((l): l is string => typeof l === "string") : [];
  });
}

const countOf = (lines: readonly string[], sign: "+" | "-"): number => lines.filter((l) => l.startsWith(sign)).length;

function toolOf(call: Call, interrupted: boolean): PaneTool {
  const verb = VERBS[call.name] ?? call.name;
  const target = targetOf(call);
  const state = call.result ? (call.result.isError ? "error" : "done") : interrupted ? "error" : "run";
  const tool: PaneTool = { id: call.id, name: call.name, verb, state };
  if (target) tool.target = target;
  if (call.at !== undefined && call.result?.at !== undefined && call.result.at >= call.at) tool.durationMs = call.result.at - call.at;
  if (call.name === "Edit" || call.name === "MultiEdit" || call.name === "Write") {
    const lines = patchLines(call.result?.extra);
    if (lines.length > 0) {
      tool.added = countOf(lines, "+");
      tool.removed = countOf(lines, "-");
    }
  }
  return tool;
}

/** The diff card: the turn's latest Edit or Write that came back with a patch. */
function diffOf(calls: readonly Call[]): PaneDiff | undefined {
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i]!;
    if (call.name !== "Edit" && call.name !== "MultiEdit" && call.name !== "Write") continue;
    const lines = patchLines(call.result?.extra);
    if (lines.length === 0) continue;
    const changed = lines.filter((l) => l.startsWith("+") || l.startsWith("-"));
    const file = asString(asRecord(call.result?.extra)?.["filePath"]) ?? asString(call.input["file_path"]);
    return {
      ...(file ? { file: basename(file) } : {}),
      added: countOf(lines, "+"),
      removed: countOf(lines, "-"),
      lines: changed.slice(0, PANE_DIFF_LINES),
    };
  }
  return undefined;
}

const isDone = (status: unknown): boolean => status === "completed" || status === "done";

/** TodoWrite: the latest call's list. */
function todoPlan(calls: readonly Call[]): PanePlanItem[] | undefined {
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i]!;
    if (call.name !== "TodoWrite") continue;
    const todos = call.input["todos"];
    if (!Array.isArray(todos)) continue;
    const items = todos
      .map(asRecord)
      .filter((t): t is Record<string, unknown> => !!t)
      .flatMap((t) => {
        const text = asString(t["content"]) ?? asString(t["subject"]);
        return text ? [{ text, done: isDone(t["status"]) }] : [];
      });
    if (items.length > 0) return items;
  }
  return undefined;
}

/** The id a TaskCreate result gives the new task: its structured result, else `#<n>` in the text. */
function taskId(call: Call, fallback: number): string {
  const task = asRecord(asRecord(call.result?.extra)?.["task"]);
  const id = task?.["id"];
  if (typeof id === "string" || typeof id === "number") return String(id);
  return /#(\d+)/.exec(call.result?.text ?? "")?.[1] ?? String(fallback);
}

/** TaskCreate and TaskUpdate folded in call order: updates set the status, a deleted task leaves. */
function taskPlan(calls: readonly Call[]): PanePlanItem[] | undefined {
  const tasks: Array<{ id: string; text: string; done: boolean }> = [];
  for (const call of calls) {
    if (call.name === "TaskCreate") {
      const text = asString(call.input["subject"]) ?? asString(call.input["description"]);
      if (text) tasks.push({ id: taskId(call, tasks.length + 1), text, done: false });
    } else if (call.name === "TaskUpdate") {
      const id = asString(call.input["taskId"]) ?? (typeof call.input["taskId"] === "number" ? String(call.input["taskId"]) : undefined);
      const at = tasks.findIndex((t) => t.id === id);
      if (at < 0) continue;
      const status = call.input["status"];
      if (status === "deleted") tasks.splice(at, 1);
      else {
        if (status !== undefined) tasks[at]!.done = isDone(status);
        const text = asString(call.input["subject"]);
        if (text) tasks[at]!.text = text;
      }
    }
  }
  return tasks.length > 0 ? tasks.map(({ text, done }) => ({ text, done })) : undefined;
}

const CHECKBOX = /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/;

/** The checkboxes of a Markdown plan; undefined when it has none. */
export function parseCheckboxes(markdown: string): PanePlanItem[] | undefined {
  const items: PanePlanItem[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = CHECKBOX.exec(line);
    if (m) items.push({ text: m[2]!, done: m[1] !== " " });
  }
  return items.length > 0 ? items : undefined;
}

/** ExitPlanMode: the checkboxes of the latest plan the agent proposed. */
function exitPlan(calls: readonly Call[]): PanePlanItem[] | undefined {
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i]!;
    const plan = call.name === "ExitPlanMode" ? asString(call.input["plan"]) : undefined;
    const items = plan ? parseCheckboxes(plan) : undefined;
    if (items) return items;
  }
  return undefined;
}

/**
 * The plan, from the first source that has one: TodoWrite, the Task tools,
 * the checkboxes of an ExitPlanMode plan, then the spec's `_plan.md`.
 */
export function planOf(
  calls: readonly Call[],
  fallback?: readonly PanePlanItem[],
): { plan: PanePlanItem[]; source: PanePlanSource } | undefined {
  const todo = todoPlan(calls);
  if (todo) return { plan: todo, source: "todo" };
  const tasks = taskPlan(calls);
  if (tasks) return { plan: tasks, source: "task" };
  const exit = exitPlan(calls);
  if (exit) return { plan: exit, source: "exit-plan" };
  if (fallback && fallback.length > 0) return { plan: [...fallback], source: "spec" };
  return undefined;
}

/**
 * Output tokens per second of the latest response. Claude Code writes one
 * entry per content block of a response, all with the same `message.id` and
 * `usage`; the response took as long as from the entry before its first block
 * (the prompt or the tool result it answered) to its last block.
 */
export function tokPerSecOf(entries: readonly PaneEntry[]): number | undefined {
  let last = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const m = entries[i]!.message;
    if (m?.role === "assistant" && m.id && typeof m.usage?.output_tokens === "number") {
      last = i;
      break;
    }
  }
  if (last < 0) return undefined;
  const id = entries[last]!.message!.id;
  const tokens = entries[last]!.message!.usage!.output_tokens as number;
  let first = last;
  while (first > 0 && entries[first - 1]!.message?.role === "assistant" && entries[first - 1]!.message?.id === id) first--;
  let before = first - 1;
  while (before >= 0 && timeOf(entries[before]) === undefined) before--;
  const from = before >= 0 ? timeOf(entries[before]) : undefined;
  const to = timeOf(entries[last]);
  if (from === undefined || to === undefined || to <= from || tokens <= 0) return undefined;
  return Math.round(tokens / ((to - from) / 1000));
}

/** The index of the latest genuine prompt, or -1. */
function turnStart(entries: readonly PaneEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) if (promptText(entries[i]!) !== undefined) return i;
  return -1;
}

/** True when an interrupt marker follows `index`: the user stopped the turn there. */
function interruptedAfter(entries: readonly PaneEntry[], index: number): boolean {
  for (let i = index + 1; i < entries.length; i++) {
    const e = entries[i] as { message?: { content?: unknown }; content?: unknown };
    const content = e.message?.content ?? e.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => asString(asRecord(b)?.["text"]) ?? "").join(" ") : "";
    if (text.trim().startsWith("[Request interrupted")) return true;
  }
  return false;
}

/**
 * Build what the agent pane shows from a session's transcript: the head's
 * model, the turn (prompt, prose, tools paired by id with their durations, the
 * latest diff), the plan and the response speed. Pure, and tolerant: a field
 * the transcript does not give is left out.
 *
 * Tools are paired over the whole transcript, so a call and its result land
 * together wherever the cut falls; only the turn's are listed.
 */
export function buildAgentPaneSnapshot(entries: readonly PaneEntry[], inputs: PaneInputs): AgentPaneSnapshot {
  const calls = pairCalls(entries);
  const start = turnStart(entries);
  const turnEntries = entries.slice(Math.max(start, 0));
  const turnCalls = calls.filter((c) => c.index >= Math.max(start, 0));

  const prompt = start >= 0 ? promptText(entries[start]!) : undefined;
  const prose: string[] = [];
  for (const e of turnEntries) {
    if (e.message?.role !== "assistant") continue;
    for (const b of blocksOf(e)) {
      const text = b["type"] === "text" ? asString(b["text"]) : undefined;
      if (text?.trim()) prose.push(collapse(text));
    }
  }
  const tools = turnCalls
    .filter((c) => !PLAN_TOOLS.has(c.name))
    .map((c) => toolOf(c, !c.result && interruptedAfter(entries, c.index)));
  const diff = diffOf(turnCalls);

  let model: string | undefined;
  let permissionMode: string | undefined;
  let updatedAtMs: number | undefined;
  for (const e of entries) {
    if (e.message?.role === "assistant" && e.message.model) model = e.message.model;
    if (e.type === "permission-mode" && typeof e.permissionMode === "string") permissionMode = e.permissionMode;
    updatedAtMs = timeOf(e) ?? updatedAtMs;
  }

  const plan = planOf(calls, inputs.fallbackPlan);
  const tokPerSec = tokPerSecOf(entries);
  const turn = {
    ...(prompt !== undefined ? { prompt } : {}),
    ...(prose.length ? { prose: prose.slice(-PANE_PROSE_BLOCKS) } : {}),
    ...(tools.length ? { tools } : {}),
    ...(diff ? { diff } : {}),
  };
  return {
    sessionId: inputs.sessionId,
    ...(inputs.title ? { title: inputs.title } : {}),
    ...(model ? { model } : {}),
    ...(inputs.state ? { state: inputs.state } : {}),
    ...(inputs.needsYou !== undefined ? { needsYou: inputs.needsYou } : {}),
    ...(permissionMode ? { permissionMode, planMode: permissionMode === "plan" } : {}),
    ...(Object.keys(turn).length ? { turn } : {}),
    ...(plan ? { plan: plan.plan, planSource: plan.source } : {}),
    ...(tokPerSec !== undefined ? { tokPerSec } : {}),
    ...(calls.length ? { toolCount: calls.length } : {}),
    ...(updatedAtMs !== undefined ? { updatedAtMs } : {}),
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * What to push when the transcript moved from `prev` to `next`: nothing when
 * they match, a delta when the turn is the same one (its prompt is, and it
 * has not lost tools), else the whole snapshot.
 */
export function diffSnapshots(
  prev: AgentPaneSnapshot | undefined,
  next: AgentPaneSnapshot,
): { kind: "snapshot"; snapshot: AgentPaneSnapshot } | { kind: "delta"; delta: AgentPaneDelta } | undefined {
  if (prev && same(prev, next)) return undefined;
  const oldTools = prev?.turn?.tools ?? [];
  const newTools = next.turn?.tools ?? [];
  const sameTurn =
    !!prev &&
    prev.sessionId === next.sessionId &&
    prev.turn?.prompt === next.turn?.prompt &&
    oldTools.every((t, i) => newTools[i]?.id === t.id);
  if (!sameTurn || !prev) return { kind: "snapshot", snapshot: next };

  const delta: AgentPaneDelta = { sessionId: next.sessionId };
  const changedTools = newTools.filter((t, i) => i >= oldTools.length || !same(t, oldTools[i]));
  if (changedTools.length) delta.tools = changedTools;
  if (!same(prev.turn?.prose, next.turn?.prose) && next.turn?.prose) delta.prose = next.turn.prose;
  if (!same(prev.turn?.diff, next.turn?.diff) && next.turn?.diff) delta.diff = next.turn.diff;
  if (!same(prev.plan, next.plan) && next.plan) {
    delta.plan = next.plan;
    if (next.planSource) delta.planSource = next.planSource;
  }
  for (const key of ["title", "model", "state", "needsYou", "permissionMode", "planMode", "tokPerSec", "toolCount", "updatedAtMs"] as const) {
    if (!same(prev[key], next[key]) && next[key] !== undefined) (delta as unknown as Record<string, unknown>)[key] = next[key];
  }
  // A field that went away (a plan removed, a diff gone) cannot be said in a delta.
  const lost = (["plan", "model", "tokPerSec"] as const).some((k) => prev[k] !== undefined && next[k] === undefined) ||
    (prev.turn?.diff !== undefined && next.turn?.diff === undefined);
  if (lost) return { kind: "snapshot", snapshot: next };
  return { kind: "delta", delta };
}
