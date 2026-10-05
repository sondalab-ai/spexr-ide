import path from "path";
import type { Readiness, ThemeState } from "./app";
import type { NativeShot } from "./native";
import type { Os, Theme } from "./prepare";
import type { LightsCheck } from "./lights";
import type { FullScreenProbe, LogProbes, MainProbes, PageProbes, ZoomProbe } from "./probes";
import type { SceneResult } from "./scenes";

/** Artifacts: one folder per OS and theme, uploaded as `screenshots-<os>-<theme>-<attempt>`. */
export const OUT_ROOT = process.env.VISUAL_OUT ?? path.join(__dirname, "out");

/** Which commit and run a capture belongs to; on a pull request, the PR's head, not the merge commit. */
export interface Provenance {
  readonly sha: string;
  readonly ref: string;
  readonly event: string;
  readonly runId: string;
  readonly attempt: string;
}

/** What the fixture extension's `parity.probe` acknowledges. */
export interface ProbeAck {
  readonly vscodeApi?: string;
  readonly extensions?: readonly string[];
}

/**
 * `meta.json`, one per OS and theme: written by capture.visual.ts as the
 * capture goes, read by summary.ts. Optional fields are absent when the
 * capture failed before reaching them.
 */
export interface CaptureMeta {
  os: Os;
  theme: Theme;
  content: { readonly width: number; readonly height: number };
  provenance: Provenance;
  scenes: SceneResult[];
  webglAttempts?: Array<{ swiftshader: boolean; webgl2: boolean }>;
  backendLog?: string;
  run?: { workspace: string; ackDir: string; configDir: string };
  readiness?: Readiness;
  themeCheck?: ThemeState;
  extensions?: ProbeAck;
  /** True when the bottom panel started collapsed and the scene opened it. */
  bottomPanelOpened?: boolean;
  /** Where the bottom panel's top edge is, as spexr laid it out (S5c: never dragged); null when it is not showing. */
  bottomPanel?: { top: number } | null;
  baseFirstVisibleLine?: number | null;
  page?: PageProbes;
  /** The toast scene's toast and its stack, keyed like the demo's regions (S5c). */
  toastParity?: Record<string, Array<{ x: number; y: number; w: number; h: number }>>;
  main?: MainProbes;
  native?: NativeShot[];
  treeFocused?: boolean;
  /** macOS only: the traffic lights in the base scene's native capture, checked against the bar (S5b-2). */
  lights?: LightsCheck;
  /** macOS only: the lights and the mark one zoom level out (S5b-2). */
  zoom?: ZoomProbe;
  /** macOS only: the bar through a full-screen round trip (S5b-2). */
  fullScreen?: FullScreenProbe;
  error?: string;
  close?: "closed" | "killed";
  log?: LogProbes;
}

export function provenance(): Provenance {
  return {
    sha: process.env.VISUAL_HEAD_SHA || process.env.GITHUB_SHA || "unknown",
    ref: process.env.VISUAL_REF || process.env.GITHUB_REF_NAME || "unknown",
    event: process.env.GITHUB_EVENT_NAME ?? "unknown",
    runId: process.env.GITHUB_RUN_ID ?? "unknown",
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? "unknown",
  };
}
