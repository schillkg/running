export const SCHEMA_VERSION = 1;
export const APP_VERSION = "0.2.1";
export const BACKUP_FORMAT = "my-training-backup";
export const PLAN_FORMAT = "my-training-plan";

const COMPLETE_STATUSES = new Set(["done", "adjusted"]);
const ALLOWED_STATUSES = new Set(["planned", "done", "adjusted", "skipped"]);
const ALLOWED_PHASES = new Set(["baseline", "base", "build", "cutback", "peak", "taper", "race", "recovery", "extra"]);

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localDateFromKey(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function formatDate(dateKey, options = { weekday: "long", month: "long", day: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, options).format(localDateFromKey(dateKey));
}

export function daysBetween(fromKey, toKey) {
  const dayMs = 86400000;
  return Math.round((localDateFromKey(toKey) - localDateFromKey(fromKey)) / dayMs);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function buildInitialState(planPackage) {
  validatePlanPackage(planPackage);
  const state = {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    activeGoalId: planPackage.goal.id,
    seededPlanVersions: [planPackage.goal.planVersion],
    goals: [structuredClone(planPackage.goal)],
    sessions: structuredClone(planPackage.sessions),
    routines: structuredClone(planPackage.routines ?? []),
    locations: structuredClone(planPackage.locations ?? []),
    preferences: {
      units: "miles",
      onboardingComplete: false,
      hiddenGoalIds: [],
      hiddenRoutineIds: [],
      changesSinceBackup: 0,
      lastBackupAt: null,
    },
  };
  return normalizeState(state);
}

export function mergeSeedPlan(state, planPackage) {
  validatePlanPackage(planPackage);
  const next = structuredClone(state);
  next.seededPlanVersions ??= [];
  if (next.seededPlanVersions.includes(planPackage.goal.planVersion)) return next;

  const goalIndex = next.goals.findIndex((goal) => goal.id === planPackage.goal.id);
  if (goalIndex === -1) {
    next.goals.push(structuredClone(planPackage.goal));
  } else {
    next.goals[goalIndex] = { ...structuredClone(planPackage.goal), ...next.goals[goalIndex] };
  }

  const existingSessions = new Map(next.sessions.map((session) => [session.id, session]));
  for (const incoming of planPackage.sessions) {
    const existing = existingSessions.get(incoming.id);
    if (!existing) {
      next.sessions.push(structuredClone(incoming));
      continue;
    }
    Object.assign(existing, structuredClone(incoming), {
      status: existing.status,
      log: existing.log,
    });
  }

  next.routines = mergeById(next.routines, planPackage.routines ?? []);
  next.locations = mergeById(next.locations, planPackage.locations ?? []);
  next.seededPlanVersions.push(planPackage.goal.planVersion);
  next.revision += 1;
  return normalizeState(next);
}

function mergeById(existing, incoming) {
  const result = structuredClone(existing ?? []);
  const index = new Map(result.map((item, itemIndex) => [item.id, itemIndex]));
  for (const item of incoming) {
    if (index.has(item.id)) result[index.get(item.id)] = structuredClone(item);
    else result.push(structuredClone(item));
  }
  return result;
}

export function normalizeState(input) {
  if (!input || typeof input !== "object") throw new Error("Training data is missing.");
  if (Number(input.schemaVersion) !== SCHEMA_VERSION) throw new Error("This backup uses an unsupported data version.");

  const state = structuredClone(input);
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision > 1_000_000_000) {
    throw new Error("Training data has an invalid revision.");
  }
  state.goals = Array.isArray(state.goals) ? state.goals : [];
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  state.routines = Array.isArray(state.routines) ? state.routines : [];
  state.locations = Array.isArray(state.locations) ? state.locations : [];
  state.seededPlanVersions = Array.isArray(state.seededPlanVersions) ? state.seededPlanVersions : [];
  const preferences = state.preferences && typeof state.preferences === "object" ? state.preferences : {};
  state.preferences = {
    units: preferences.units === "kilometers" ? "kilometers" : "miles",
    onboardingComplete: typeof preferences.onboardingComplete === "boolean" ? preferences.onboardingComplete : true,
    hiddenGoalIds: Array.isArray(preferences.hiddenGoalIds)
      ? [...new Set(preferences.hiddenGoalIds.filter((id) => typeof id === "string"))]
      : [],
    hiddenRoutineIds: Array.isArray(preferences.hiddenRoutineIds)
      ? [...new Set(preferences.hiddenRoutineIds.filter((id) => typeof id === "string"))]
      : [],
    changesSinceBackup: Number.isSafeInteger(preferences.changesSinceBackup) && preferences.changesSinceBackup >= 0
      ? Math.min(preferences.changesSinceBackup, 100_000)
      : 0,
    lastBackupAt: typeof preferences.lastBackupAt === "string" && Number.isFinite(Date.parse(preferences.lastBackupAt))
      ? preferences.lastBackupAt
      : null,
  };

  const goalIds = new Set();
  for (const goal of state.goals) {
    if (!goal || typeof goal.id !== "string" || !goal.id) throw new Error("A goal is missing its identifier.");
    if (goalIds.has(goal.id)) throw new Error("The backup contains duplicate goals.");
    if (goal.eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(goal.eventDate)) throw new Error("A goal has an invalid event date.");
    if (goal.planningNotes !== undefined && (typeof goal.planningNotes !== "string" || goal.planningNotes.length > 2000)) {
      throw new Error("A goal has invalid planning notes.");
    }
    goalIds.add(goal.id);
  }
  state.preferences.hiddenGoalIds = state.preferences.hiddenGoalIds.filter((id) => goalIds.has(id));

  const sessionIds = new Set();
  for (const session of state.sessions) {
    if (!session || typeof session.id !== "string" || !session.id) throw new Error("A workout is missing its identifier.");
    if (sessionIds.has(session.id)) throw new Error("The backup contains duplicate workouts.");
    sessionIds.add(session.id);
    if (!goalIds.has(session.goalId)) throw new Error("A workout refers to a goal that is not present.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date)) throw new Error("A workout has an invalid date.");
    if (session.weekNumber !== null && (!Number.isInteger(session.weekNumber) || session.weekNumber < 1 || session.weekNumber > 200)) {
      throw new Error("A workout has an invalid week number.");
    }
    if (typeof session.weekLabel !== "string" || session.weekLabel.length > 80) throw new Error("A workout has an invalid week label.");
    if (typeof session.phase !== "string" || !ALLOWED_PHASES.has(session.phase)) throw new Error("A workout has an invalid training phase.");
    if (session.planMinutes !== null && (!Number.isFinite(session.planMinutes) || session.planMinutes < 0 || session.planMinutes > 10000)) {
      throw new Error("A workout has invalid planned minutes.");
    }
    if (!ALLOWED_STATUSES.has(session.status)) {
      session.status = session.status === "modified" ? "adjusted" : "planned";
    }
  }

  const routineIds = new Set();
  for (const routine of state.routines) {
    if (!routine || typeof routine.id !== "string" || !routine.id || routineIds.has(routine.id)) {
      throw new Error("A routine has an invalid or duplicate identifier.");
    }
    routineIds.add(routine.id);
    if (typeof routine.name !== "string" || !routine.name || routine.name.length > 200) throw new Error("A routine has an invalid name.");
    if (typeof routine.durationText !== "string" || routine.durationText.length > 200) throw new Error("A routine has an invalid duration.");
    if (typeof routine.schedule !== "string" || routine.schedule.length > 1000) throw new Error("A routine has an invalid schedule.");
    if (!Array.isArray(routine.exercises) || routine.exercises.length > 100) throw new Error("A routine has invalid exercises.");
    if (!Array.isArray(routine.rules) || routine.rules.length > 100 || routine.rules.some((rule) => typeof rule !== "string" || rule.length > 1000)) {
      throw new Error("A routine has invalid rules.");
    }
    for (const exercise of routine.exercises) {
      if (!exercise || [exercise.name, exercise.dose, exercise.cue, exercise.purpose].some((value) => typeof value !== "string" || value.length > 1000)) {
        throw new Error("A routine has an invalid exercise.");
      }
    }
  }
  state.preferences.hiddenRoutineIds = state.preferences.hiddenRoutineIds.filter((id) => routineIds.has(id));

  const hiddenGoalIds = new Set(state.preferences.hiddenGoalIds);
  if (!goalIds.has(state.activeGoalId) || hiddenGoalIds.has(state.activeGoalId)) {
    state.activeGoalId = state.goals.find((goal) => !hiddenGoalIds.has(goal.id))?.id ?? null;
  }
  return state;
}

export function validatePlanPackage(input) {
  if (!input || input.format !== PLAN_FORMAT) throw new Error("That file is not a Stridebook plan.");
  if (Number(input.schemaVersion) !== SCHEMA_VERSION) throw new Error("That plan uses an unsupported data version.");
  if (!input.goal || typeof input.goal.id !== "string" || !input.goal.id) throw new Error("The plan is missing its goal.");
  if (!Array.isArray(input.sessions)) throw new Error("The plan is missing its workouts.");
  const ids = new Set();
  for (const session of input.sessions) {
    if (!session || typeof session.id !== "string" || !session.id) throw new Error("A workout is missing its identifier.");
    if (ids.has(session.id)) throw new Error("The plan contains duplicate workouts.");
    ids.add(session.id);
    if (session.goalId !== input.goal.id) throw new Error("A workout is attached to the wrong goal.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date)) throw new Error("A workout has an invalid date.");
  }
  return true;
}

export function validateBackup(input) {
  if (!input || input.format !== BACKUP_FORMAT) throw new Error("That file is not a Stridebook backup.");
  if (Number(input.schemaVersion) !== SCHEMA_VERSION) throw new Error("That backup uses an unsupported data version.");
  normalizeState(input.state);
  return true;
}

export function importPlan(state, planPackage) {
  validatePlanPackage(planPackage);
  const next = structuredClone(state);
  const existingGoalIndex = next.goals.findIndex((goal) => goal.id === planPackage.goal.id);
  if (existingGoalIndex !== -1) {
    const existingGoal = next.goals[existingGoalIndex];
    const existingSessions = next.sessions.some((session) => session.goalId === existingGoal.id);
    if (existingGoal.status !== "draft" || existingSessions) {
      throw new Error("That goal already exists. No changes were made.");
    }
    next.goals[existingGoalIndex] = structuredClone(planPackage.goal);
  } else {
    next.goals.push(structuredClone(planPackage.goal));
  }
  next.sessions.push(...structuredClone(planPackage.sessions));
  next.routines = mergeById(next.routines, planPackage.routines ?? []);
  next.locations = mergeById(next.locations, planPackage.locations ?? []);
  next.activeGoalId = planPackage.goal.id;
  next.preferences.hiddenGoalIds = next.preferences.hiddenGoalIds.filter((id) => id !== planPackage.goal.id);
  next.revision += 1;
  return normalizeState(next);
}

export function visibleGoals(state) {
  const hiddenGoalIds = new Set(state.preferences?.hiddenGoalIds ?? []);
  return state.goals.filter((goal) => !hiddenGoalIds.has(goal.id));
}

export function activeGoal(state) {
  const visible = visibleGoals(state);
  return visible.find((goal) => goal.id === state.activeGoalId) ?? visible[0] ?? null;
}

export function sessionsForGoal(state, goalId = activeGoal(state)?.id) {
  return state.sessions
    .filter((session) => session.goalId === goalId)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

export function summarizeGoal(state, goalId = activeGoal(state)?.id) {
  const sessions = sessionsForGoal(state, goalId);
  const completed = sessions.filter((session) => COMPLETE_STATUSES.has(session.status));
  const actualMinutes = completed.reduce((sum, session) => sum + numberOrZero(session.log?.actualMinutes), 0);
  const actualMiles = completed.reduce((sum, session) => sum + numberOrZero(session.log?.actualMiles), 0);
  const longestMinutes = completed.reduce((max, session) => Math.max(max, numberOrZero(session.log?.actualMinutes)), 0);
  const plannedCount = sessions.length;
  const completedPlanCount = completed.length;
  return {
    sessions,
    completedCount: completed.length,
    plannedCount,
    completedPlanCount,
    actualMinutes,
    actualMiles,
    longestMinutes,
    percent: plannedCount ? Math.min(100, Math.round((completedPlanCount / plannedCount) * 100)) : 0,
  };
}

export function weekForDate(sessions, todayKey) {
  const onDate = sessions.find((session) => session.date === todayKey && session.weekNumber);
  if (onDate) return onDate.weekNumber;
  const upcoming = sessions.find((session) => session.date > todayKey && session.weekNumber);
  if (upcoming) return upcoming.weekNumber;
  return [...sessions].reverse().find((session) => session.weekNumber)?.weekNumber ?? null;
}

export function nextSession(sessions, todayKey, includeToday = true) {
  return sessions.find((session) => includeToday ? session.date >= todayKey : session.date > todayKey) ?? null;
}

export function isCompleteStatus(status) {
  return COMPLETE_STATUSES.has(status);
}

export function statusLabel(status) {
  return ({ planned: "Planned", done: "Done", adjusted: "Adjusted", skipped: "Skipped" })[status] ?? "Planned";
}

export function typeLabel(type) {
  return ({ easy: "Easy", quality: "Quality", long: "Long", race: "Race", recovery: "Recovery" })[type] ?? "Workout";
}

export function createDraftGoal({ name, eventDate, distance, runDays, planningNotes }, existingGoals) {
  const title = String(name ?? "").trim();
  if (!title) throw new Error("Enter a goal or race name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(eventDate ?? ""))) throw new Error("Choose an event date.");
  const base = slugify(`${title}-${eventDate}`) || `goal-${Date.now()}`;
  let id = base;
  let suffix = 2;
  const ids = new Set(existingGoals.map((goal) => goal.id));
  while (ids.has(id)) id = `${base}-${suffix++}`;
  return {
    id,
    planVersion: `${id}-draft-v1`,
    title,
    subtitle: "Draft goal · plan not created yet",
    eventDate,
    planStart: null,
    planEnd: eventDate,
    distance: String(distance ?? "").trim() || "Custom",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    status: "draft",
    preferredRunDays: Number(runDays) || 3,
    planningNotes: String(planningNotes ?? "").trim().slice(0, 2000),
    primaryGoal: "Build a sensible plan from current training history",
    rules: [],
    sources: [],
  };
}

export function buildPlanRequest(state, goalId) {
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal) throw new Error("Goal not found.");
  const selectedGoal = activeGoal(state);
  const visible = visibleGoals(state);
  const currentGoal = selectedGoal?.id === goalId && goal.status === "draft"
    ? visible.find((item) => item.id !== goalId && item.status !== "draft") ?? selectedGoal
    : selectedGoal;
  const history = summarizeGoal(state, currentGoal?.id);
  const recent = history.sessions
    .filter((session) => isCompleteStatus(session.status))
    .slice(-12)
    .map((session) => ({
      date: session.date,
      title: session.title,
      actualMinutes: session.log?.actualMinutes ?? null,
      actualMiles: session.log?.actualMiles ?? null,
      notes: session.log?.notes ?? "",
    }));
  return {
    format: "my-training-plan-request",
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    goal,
    currentTraining: {
      sourceGoal: currentGoal?.title ?? null,
      completedWorkouts: history.completedCount,
      actualMinutes: history.actualMinutes,
      actualMiles: round(history.actualMiles, 2),
      longestMinutes: history.longestMinutes,
      recent,
    },
  };
}

export function isBackupDue(state, now = new Date()) {
  const changes = Number(state.preferences?.changesSinceBackup ?? 0);
  if (changes >= 3) return true;
  const lastBackupAt = state.preferences?.lastBackupAt;
  if (!lastBackupAt || changes < 1) return false;
  const elapsed = now.getTime() - new Date(lastBackupAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 7 * 86400000;
}

export function toBackup(state) {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    state: normalizeState(state),
  };
}

export function toWorkoutCsv(state) {
  const headers = [
    "Goal", "Date", "Week", "Workout", "Surface", "Plan min", "Effort", "Status",
    "Actual min", "Actual mi", "Notes",
  ];
  const goals = new Map(state.goals.map((goal) => [goal.id, goal.title]));
  const rows = [...state.sessions]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((session) => [
      goals.get(session.goalId) ?? session.goalId,
      session.date,
      session.weekLabel ?? "",
      session.workoutText ?? session.title,
      session.surface ?? "",
      session.planMinutes ?? "",
      session.effortRaw ?? "",
      statusLabel(session.status),
      session.log?.actualMinutes ?? "",
      session.log?.actualMiles ?? "",
      session.log?.notes ?? "",
    ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safeText) ? `"${safeText.replaceAll('"', '""')}"` : safeText;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
