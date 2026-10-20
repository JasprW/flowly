import { useSyncExternalStore } from "react";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { Idea, NextMove, Project, Task } from "../shared/model";
import type { NextRowData, SummaryRowData } from "../shared/native-session";

/**
 * What Paseo's session view shows for a Flowly-managed session (NATIVE-SESSION-SPEC §6-8): the current Next moves
 * (for the timeline card) and the card's open ideas (for the Ideas chip). The chip refresh (`client/session-link.ts`)
 * fills it; popover contents and timeline rows read it, since host-rendered components get no props of ours.
 */
export type ChipState = {
  task: Task;
  project: Project;
  agentId: string;
  /** This turn's suggestions, or null when the Next moves card is hidden. */
  moves: { eventId: string; moves: NextMove[] } | null;
  /** The card's open ideas, newest first. */
  ideas: Idea[];
  /** The Auto wrap up setting: Move to Done then asks nothing here. */
  autoWrapup: boolean;
  /** What tapping a message suggestion on the Next moves card does (NATIVE-SESSION-SPEC §6.4). */
  nextMoveTap: "fill" | "copy";
};

let client: PluginClientContext | null = null;
const states = new Map<string, ChipState>();
const listeners = new Set<() => void>();

/** The plugin context that registered the chips; null after teardown, so late actions do nothing. */
export function setChipClient(next: PluginClientContext | null) {
  client = next;
}
export function chipClient() {
  return client;
}

export function setChipState(agentId: string, state: ChipState | null) {
  if (state) states.set(agentId, state);
  else if (!states.delete(agentId)) return;
  listeners.forEach((listener) => listener());
}
export function chipStateIds() {
  return [...states.keys()];
}
export function chipState(agentId: string) {
  return states.get(agentId) ?? null;
}
export function clearChipStates() {
  if (!states.size && !pending.size) return;
  states.clear();
  pending.clear();
  listeners.forEach((listener) => listener());
}

/**
 * A wrap-up question the Next moves card is showing after Move to Done (NATIVE-SESSION-SPEC §6.4). Kept here, not in
 * the card, because moving the card to Done ends its suggestion set and the card would otherwise hide with the
 * question.
 */
export type WrapPending = { need: "ask" | "needs-flowly"; state: ChipState };
const pending = new Map<string, WrapPending>();
export function setWrapPending(agentId: string, eventId: string, value: WrapPending | null) {
  const key = `${agentId}:${eventId}`;
  if (value) pending.set(key, value);
  else if (!pending.delete(key)) return;
  listeners.forEach((listener) => listener());
}
export function wrapPending(agentId: string, eventId: string) {
  return pending.get(`${agentId}:${eventId}`) ?? null;
}
export function useWrapPending(agentId: string, eventId: string) {
  return useSyncExternalStore(subscribe, () => wrapPending(agentId, eventId));
}
/** What a Next moves timeline row shows: its open wrap-up question, its moves while they are current, or nothing. */
export function cardView(row: NextRowData, state: Pick<ChipState, "moves"> | null, agentId: string): "wrap" | "moves" | "hidden" {
  if (row.status !== "ready") return "hidden";
  if (wrapPending(agentId, row.eventId)) return "wrap";
  return state?.moves?.eventId === row.eventId ? "moves" : "hidden";
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function useChipState(agentId: string) {
  return useSyncExternalStore(subscribe, () => chipState(agentId));
}

let refresher: (() => void) | null = null;
/** Set by the chip refresh; null after teardown. */
export function setChipRefresher(next: (() => void) | null) {
  refresher = next;
}
/** After an action changed what the chips show (an idea dismissed, a card moved): refresh now, not at the next round. */
export function refreshChipsNow() {
  refresher?.();
}

let requestSequence = 0;
export const chipRequestId = () => `${Date.now()}-n${++requestSequence}`;

/** "Open card" on a summary row: the same validated board link as the Task chip (SESSION-CHIP-SPEC). */
export function openCardFromRow(data: Pick<SummaryRowData, "taskId" | "workspaceId">, agentId: string) {
  client?.openScreen({
    screenId: "board",
    params: { taskId: data.taskId, workspaceId: data.workspaceId, sessionId: agentId, requestId: chipRequestId() },
  });
}
