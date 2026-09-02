import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  BACKUP_FORMAT,
  buildInitialState,
  buildPlanRequest,
  createDraftGoal,
  escapeHtml,
  importPlan,
  isBackupDue,
  mergeSeedPlan,
  normalizeState,
  summarizeGoal,
  toBackup,
  toWorkoutCsv,
  validateBackup,
  visibleGoals,
} from "../js/model.js";

const seed = JSON.parse(await fs.readFile(new URL("../data/fall-creek-2026.json", import.meta.url), "utf8"));

test("Fall Creek seed contains the complete public plan and references", () => {
  const state = buildInitialState(seed);
  assert.equal(state.goals.length, 1);
  assert.equal(state.sessions.length, 49);
  assert.equal(state.routines.length, 2);
  assert.equal(state.locations.length, 10);
  assert.equal(state.sessions[0].date, "2026-08-31");
  assert.equal(state.sessions.at(-1).date, "2026-11-22");
  assert.equal(state.preferences.onboardingComplete, false);
});

test("seeding again never duplicates plan data", () => {
  const state = buildInitialState(seed);
  const merged = mergeSeedPlan(state, seed);
  assert.equal(merged.sessions.length, 49);
  assert.equal(merged.locations.length, 10);
});

test("progress counts Done and Adjusted without persisting aggregates", () => {
  const state = buildInitialState(seed);
  state.sessions[0].status = "done";
  state.sessions[0].log = { actualMinutes: 30, actualMiles: 3.1, notes: "Good" };
  state.sessions[1].status = "adjusted";
  state.sessions[1].log = { actualMinutes: 42, actualMiles: 4.2, notes: "Longer" };
  const summary = summarizeGoal(state);
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.actualMinutes, 72);
  assert.ok(Math.abs(summary.actualMiles - 7.3) < 0.0001);
  assert.equal(summary.longestMinutes, 42);
});

test("complete backup validates and CSV safely quotes notes", () => {
  const state = buildInitialState(seed);
  state.sessions[0].status = "done";
  state.sessions[0].log = { actualMinutes: 30, actualMiles: 3.1, notes: "Easy, ankle good" };
  const backup = toBackup(state);
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(validateBackup(backup), true);
  assert.match(toWorkoutCsv(state), /"Easy, ankle good"/);
});

test("CSV export neutralizes spreadsheet formulas in user text", () => {
  const state = buildInitialState(seed);
  state.sessions[0].status = "done";
  state.sessions[0].log = { actualMinutes: 30, actualMiles: 3.1, notes: "=1+1" };
  assert.match(toWorkoutCsv(state), /'=1\+1/);
});

test("draft goal can be replaced safely by its generated plan", () => {
  const state = buildInitialState(seed);
  const draft = createDraftGoal({ name: "Spring half", eventDate: "2027-04-24", distance: "Half marathon", runDays: 4 }, state.goals);
  state.goals.push(draft);
  const plan = {
    ...seed,
    goal: { ...draft, status: "active", subtitle: "10-week plan" },
    sessions: [{ ...seed.sessions[0], id: `${draft.id}-s1`, goalId: draft.id, date: "2027-02-17" }],
    routines: [],
    locations: [],
  };
  const imported = importPlan(state, plan);
  assert.equal(imported.activeGoalId, draft.id);
  assert.equal(imported.sessions.filter((session) => session.goalId === draft.id).length, 1);
  assert.equal(buildPlanRequest(imported, draft.id).goal.id, draft.id);
});

test("existing version 1 data skips first-run onboarding", () => {
  const state = buildInitialState(seed);
  state.preferences = { units: "miles" };
  const migrated = normalizeState(state);
  assert.equal(migrated.preferences.onboardingComplete, true);
  assert.deepEqual(migrated.preferences.hiddenGoalIds, []);
  assert.deepEqual(migrated.preferences.hiddenRoutineIds, []);
});

test("hidden goals stay stored but are excluded from active views", () => {
  const state = buildInitialState(seed);
  state.preferences.hiddenGoalIds = [seed.goal.id];
  state.activeGoalId = seed.goal.id;
  const normalized = normalizeState(state);
  assert.equal(normalized.goals.length, 1);
  assert.equal(visibleGoals(normalized).length, 0);
  assert.equal(normalized.activeGoalId, null);
});

test("hidden strength routines remain stored and can be restored", () => {
  const state = buildInitialState(seed);
  const routineId = state.routines[0].id;
  state.preferences.hiddenRoutineIds = [routineId];
  const normalized = normalizeState(state);
  assert.equal(normalized.routines.some((routine) => routine.id === routineId), true);
  assert.deepEqual(normalized.preferences.hiddenRoutineIds, [routineId]);
  normalized.preferences.hiddenRoutineIds = [];
  assert.deepEqual(normalizeState(normalized).preferences.hiddenRoutineIds, []);
});

test("backup reminder waits for several changes or one unbacked week", () => {
  const state = buildInitialState(seed);
  state.preferences.changesSinceBackup = 2;
  assert.equal(isBackupDue(state, new Date("2026-09-02T12:00:00Z")), false);
  state.preferences.changesSinceBackup = 3;
  assert.equal(isBackupDue(state, new Date("2026-09-02T12:00:00Z")), true);
  state.preferences.changesSinceBackup = 1;
  state.preferences.lastBackupAt = "2026-08-20T12:00:00Z";
  assert.equal(isBackupDue(state, new Date("2026-09-02T12:00:00Z")), true);
});

test("new-goal request carries optional training context", () => {
  const state = buildInitialState(seed);
  const draft = createDraftGoal({ name: "First 5K", eventDate: "2027-04-24", distance: "5K", runDays: 3, planningNotes: "Runs twice a week." }, state.goals);
  state.goals.push(draft);
  state.activeGoalId = draft.id;
  assert.equal(buildPlanRequest(state, draft.id).goal.planningNotes, "Runs twice a week.");
});

test("user-entered text is escaped before HTML rendering", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
});

test("malicious week and phase values are rejected before rendering", () => {
  const badWeek = structuredClone(seed);
  badWeek.sessions[0].weekNumber = '"><img src=x onerror=alert(1)>';
  assert.throws(() => buildInitialState(badWeek), /week number/);
  const badPhase = structuredClone(seed);
  badPhase.sessions[0].phase = '"></option><script>alert(1)</script>';
  assert.throws(() => buildInitialState(badPhase), /training phase/);
});

test("unsafe backup revisions are rejected", () => {
  const backup = toBackup(buildInitialState(seed));
  backup.state.revision = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => validateBackup(backup), /invalid revision/);
});

test("malformed routines are rejected before rendering", () => {
  const malformed = structuredClone(seed);
  malformed.routines[0].exercises = null;
  assert.throws(() => buildInitialState(malformed), /invalid exercises/);
});
