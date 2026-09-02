import {
  APP_VERSION,
  BACKUP_FORMAT,
  PLAN_FORMAT,
  activeGoal,
  buildInitialState,
  buildPlanRequest,
  createDraftGoal,
  daysBetween,
  escapeHtml,
  formatDate,
  importPlan,
  isBackupDue,
  isCompleteStatus,
  localDateKey,
  mergeSeedPlan,
  nextSession,
  normalizeState,
  round,
  sessionsForGoal,
  statusLabel,
  summarizeGoal,
  toBackup,
  toWorkoutCsv,
  typeLabel,
  validateBackup,
  visibleGoals,
  weekForDate,
} from "./js/model.js";
import { StaleStateError, loadState, saveState } from "./js/store.js";

const main = document.querySelector("#app-main");
const headerEyebrow = document.querySelector("#header-eyebrow");
const headerTitle = document.querySelector("#header-title");
const storageWarning = document.querySelector("#storage-warning");
const sessionDialog = document.querySelector("#session-dialog");
const sessionDialogContent = document.querySelector("#session-dialog-content");
const importFile = document.querySelector("#import-file");
const toast = document.querySelector("#toast");
const navButtons = [...document.querySelectorAll("[data-route]")];

let state;
let planPackage;
let persistentStorage = true;
let selectedWeek = null;
let locationFilter = "all";
let installPrompt = null;
let toastTimer = null;
let broadcast = null;

const validRoutes = new Set(["today", "plan", "progress", "locations", "routines", "new-goal", "help"]);

await initialize();

async function initialize() {
  try {
    let storedRaw = null;
    try {
      storedRaw = await loadState();
    } catch (error) {
      persistentStorage = false;
      showStorageWarning();
      console.warn(error);
    }

    const stored = storedRaw ? normalizeState(storedRaw) : null;
    let seedError = null;
    try {
      const response = await fetch("./data/fall-creek-2026.json", { cache: "no-cache" });
      if (!response.ok) throw new Error("The bundled training plan could not be loaded.");
      planPackage = await response.json();
    } catch (error) {
      seedError = error;
      console.warn(error);
    }

    if (stored) {
      state = stored;
      if (planPackage) {
        const merged = mergeSeedPlan(stored, planPackage);
        if (merged.revision !== stored.revision && persistentStorage) {
          try {
            await saveState(merged, stored.revision);
            state = merged;
          } catch (error) {
            if (error instanceof StaleStateError) state = normalizeState(await loadState());
            else showStorageWarning("Your saved history is loaded, but this app update could not be saved yet.");
            console.warn(error);
          }
        } else if (merged.revision !== stored.revision) {
          state = merged;
        }
      }
    } else {
      if (!planPackage) throw seedError ?? new Error("The training plan could not be loaded.");
      state = buildInitialState(planPackage);
      if (persistentStorage) {
        try {
          await saveState(state, 0);
        } catch (error) {
          if (error instanceof StaleStateError) state = normalizeState(await loadState());
          else {
            persistentStorage = false;
            showStorageWarning();
          }
          console.warn(error);
        }
      }
    }

    selectedWeek = weekForDate(sessionsForGoal(state), localDateKey());
    bindEvents();
    setupCrossTabUpdates();
    registerServiceWorker();
    render();
  } catch (error) {
    main.innerHTML = `<section class="panel"><h2>Could not open the app</h2><p>${escapeHtml(error.message)}</p><p class="muted">Refresh the page. If this continues, reopen the app while online.</p></section>`;
  }
}

function bindEvents() {
  window.addEventListener("hashchange", render);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (routeName() === "progress") render();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    showToast("Stridebook is installed.");
  });
  document.addEventListener("click", handleClick);
  document.addEventListener("change", handleChange);
  document.addEventListener("submit", handleSubmit);
  importFile.addEventListener("change", handleImportFile);
  sessionDialog.addEventListener("click", (event) => {
    if (event.target === sessionDialog) sessionDialog.close();
  });
}

function setupCrossTabUpdates() {
  if (!("BroadcastChannel" in globalThis) || !persistentStorage) return;
  broadcast = new BroadcastChannel("my-training-updates");
  broadcast.addEventListener("message", async (event) => {
    if (!event.data || event.data.revision <= state.revision) return;
    try {
      state = normalizeState(await loadState());
      render();
      showToast("Training data refreshed from another open tab.");
    } catch (error) {
      console.warn(error);
    }
  });
}

function routeName() {
  const route = location.hash.replace(/^#\/?/, "") || "today";
  return validRoutes.has(route) ? route : "today";
}

function navigate(route) {
  const nextHash = `#/${route}`;
  if (location.hash === nextHash) render();
  else location.hash = nextHash;
}

function render() {
  if (!state) return;
  if (!state.preferences.onboardingComplete) {
    headerEyebrow.textContent = "Your runs, one clear plan";
    headerTitle.textContent = "Stridebook";
    setActiveNav(null);
    main.innerHTML = renderOnboarding();
    return;
  }
  const route = routeName();
  const goal = activeGoal(state);
  headerEyebrow.textContent = headerLabel(route, goal);
  headerTitle.textContent = route === "locations" ? "Run locations" : route === "routines" ? "Strength" : route === "new-goal" ? "New goal" : route === "help" ? "How it works" : "Stridebook";
  setActiveNav(route);

  if (route === "today") main.innerHTML = renderToday(goal);
  if (route === "plan") main.innerHTML = renderPlan(goal);
  if (route === "progress") main.innerHTML = renderProgress(goal);
  if (route === "locations") main.innerHTML = renderLocations();
  if (route === "routines") main.innerHTML = renderRoutines();
  if (route === "new-goal") main.innerHTML = renderNewGoal();
  if (route === "help") main.innerHTML = renderHelp();
}

function headerLabel(route, goal) {
  if (route === "locations") return "Plan reference";
  if (route === "routines") return "Strength + accessory work";
  if (route === "new-goal") return "Future training";
  if (route === "help") return "Simple guide";
  return goal?.title ?? "Running plan";
}

function setActiveNav(route) {
  const active = route === "locations" || route === "routines" || route === "new-goal" ? "plan" : route === "help" ? "progress" : route;
  for (const button of navButtons) {
    const selected = button.dataset.route === active;
    button.classList.toggle("is-active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function renderOnboarding() {
  return `<section class="view welcome-view" aria-labelledby="welcome-heading"><article class="welcome-card"><div class="brand-mark" aria-hidden="true">S</div><p class="eyebrow">Welcome to Stridebook</p><h2 id="welcome-heading">What are you training for?</h2><p class="muted">Keep a dated plan, log each run, and carry your history into the next goal. Your workout data stays on this device.</p><div class="button-stack"><button class="primary-button button-block" type="button" data-action="use-fall-creek">Use the Fall Creek 50K plan</button><button class="secondary-button button-block" type="button" data-action="start-own-plan">Start my own plan</button><button class="ghost-button button-block" type="button" data-action="import-data">Restore an existing backup</button></div><p class="form-hint">You can add, switch, or hide goals later.</p></article></section>`;
}

function renderToday(goal) {
  if (!goal) return renderNoGoal("No active plan", "Start your own goal or import a plan to begin.");
  const today = localDateKey();
  const sessions = sessionsForGoal(state, goal.id);
  const todaySessions = sessions.filter((session) => session.date === today);
  const next = nextSession(sessions, today, todaySessions.length === 0);
  const countdown = goal.eventDate ? daysBetween(today, goal.eventDate) : null;

  const todayContent = todaySessions.length
    ? todaySessions.map((session) => workoutCard(session, true)).join("")
    : `<article class="workout-card"><p class="eyebrow">Today</p><h2>No run scheduled</h2><p class="muted compact">Upper body, rest, or optional accessory work.</p></article>`;

  const nextContent = next && !todaySessions.some((session) => session.id === next.id)
    ? `<article class="workout-card workout-card--primary"><p class="eyebrow">Next workout · ${escapeHtml(formatDate(next.date, { weekday: "long" }))}</p><h2>${escapeHtml(next.title)}</h2>${workoutMeta(next)}<p class="workout-text">${escapeHtml(instructionOnly(next.workoutText))}</p><button class="primary-button button-block" type="button" data-action="open-session" data-session-id="${escapeHtml(next.id)}">Log workout</button></article>`
    : "";

  return `<section class="view" aria-labelledby="today-date"><p class="date-label" id="today-date">${escapeHtml(formatDate(today))}</p>${renderBackupReminder()}${todayContent}${nextContent}<div class="button-grid"><button class="secondary-button" type="button" data-action="open-extra-workout">Log extra run</button><button class="secondary-button" type="button" data-route="routines">Strength</button></div>${Number.isFinite(countdown) && countdown >= 0 ? `<p class="install-note">${countdown === 0 ? "Race day" : `${countdown} days until ${escapeHtml(goal.title)}`}.</p>` : ""}</section>`;
}

function renderBackupReminder() {
  if (!isBackupDue(state)) return "";
  const changes = state.preferences.changesSinceBackup;
  return `<article class="backup-reminder"><div><p class="eyebrow">Backup reminder</p><strong>${changes} workout ${changes === 1 ? "change" : "changes"} since your last backup</strong><p class="muted compact text-small">Save a full restore file to Dropbox or Google Drive.</p></div><button class="primary-button" type="button" data-action="download-backup">Back up now</button></article>`;
}

function workoutCard(session, today = false) {
  const complete = isCompleteStatus(session.status);
  const cardClass = today && !complete ? "workout-card workout-card--primary" : "workout-card";
  const actionLabel = complete || session.status === "skipped" ? "Edit log" : "Log workout";
  const logLine = session.log ? `<p class="muted text-small">${escapeHtml(logSummary(session.log))}</p>` : "";
  const buttonClass = cardClass.includes("primary") ? "primary-button" : "secondary-button";
  return `<article class="${cardClass}"><div class="status-line"><span class="status-dot status-dot--${escapeHtml(session.status)}" aria-hidden="true"></span>${escapeHtml(statusLabel(session.status))}</div><h2>${escapeHtml(session.title)}</h2>${workoutMeta(session)}<p class="workout-text">${escapeHtml(instructionOnly(session.workoutText))}</p>${logLine}<button class="${buttonClass} button-block" type="button" data-action="open-session" data-session-id="${escapeHtml(session.id)}">${actionLabel}</button></article>`;
}

function workoutMeta(session) {
  const duration = session.planMinutes === null ? "Flexible" : session.planMinutes === 0 ? "Recovery" : `${session.planMinutes} min`;
  return `<p class="workout-meta"><span>${escapeHtml(duration)}</span><span>${escapeHtml(session.effortRaw || typeLabel(session.type))}</span><span>${escapeHtml(session.surface || "Any surface")}</span></p>`;
}

function renderPlan(goal) {
  if (!goal) return renderNoGoal("No active plan", "Create a goal request or import a plan file.");
  const goals = visibleGoals(state);
  const sessions = sessionsForGoal(state, goal.id);
  const weeks = [...new Set(sessions.map((session) => session.weekNumber).filter(Boolean))].sort((a, b) => a - b);
  if (!weeks.includes(selectedWeek)) selectedWeek = weekForDate(sessions, localDateKey()) ?? weeks[0] ?? null;
  const weekSessions = sessions.filter((session) => session.weekNumber === selectedWeek);
  const weekPhase = weekSessions[0]?.phase;

  const goalPicker = goals.length > 1
    ? `<label class="form-label">Training goal<select class="goal-select" data-role="goal-select">${goals.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === goal.id ? "selected" : ""}>${escapeHtml(item.title)}${item.status === "draft" ? " · draft" : ""}</option>`).join("")}</select></label>`
    : "";

  if (goal.status === "draft" || !sessions.length) {
    return `<section class="view"><div class="section-heading"><p class="date-label compact">Draft goal</p><button class="ghost-button" type="button" data-route="new-goal">New goal</button></div>${goalPicker}<article class="panel"><p class="eyebrow">${escapeHtml(goal.distance || "Custom")}</p><h2>${escapeHtml(goal.title)}</h2><p>${escapeHtml(formatDate(goal.eventDate))}</p><p class="muted">This is the goal shell. Download its request, send it to Codex, then import the plan Codex returns.</p><div class="plan-preview"><strong>After import, you will see:</strong><span>Dated workouts grouped into weeks</span><span>The next workout on Today</span><span>A separate progress view for this goal</span></div><button class="primary-button button-block" type="button" data-action="download-plan-request" data-goal-id="${escapeHtml(goal.id)}">Download plan request</button><button class="secondary-button button-block top-gap" type="button" data-action="import-data">Import finished plan</button></article>${referenceButtons()}</section>`;
  }

  return `<section class="view" aria-labelledby="plan-heading"><div class="section-heading"><div><p class="date-label compact" id="plan-heading">${escapeHtml(goal.subtitle || goal.title)}</p></div><button class="ghost-button" type="button" data-route="new-goal">New goal</button></div>${goalPicker}<div class="week-picker"><button class="week-arrow" type="button" data-action="previous-week" aria-label="Previous week">‹</button><select class="week-select" data-role="week-select" aria-label="Training week">${weeks.map((week) => `<option value="${week}" ${week === selectedWeek ? "selected" : ""}>Week ${week}${escapeHtml(phaseSuffix(sessions, week))}</option>`).join("")}</select><button class="week-arrow" type="button" data-action="next-week" aria-label="Next week">›</button></div><article class="panel"><p class="eyebrow">Week ${selectedWeek}${weekPhase && weekPhase !== "build" ? ` · ${escapeHtml(weekPhase)}` : ""}</p><div class="session-list">${weekSessions.map(sessionRow).join("") || `<p class="muted compact">No workouts in this week.</p>`}</div></article>${referenceButtons()}</section>`;
}

function referenceButtons() {
  return `<div class="reference-grid" aria-label="Plan references"><button class="reference-button" type="button" data-route="locations">Run locations</button><button class="reference-button" type="button" data-route="routines">Strength</button><button class="reference-button reference-button--wide" type="button" data-route="progress">Backup + progress</button></div>`;
}

function sessionRow(session) {
  const duration = session.planMinutes === 0 ? "Rest" : session.planMinutes === null ? "—" : `${session.planMinutes}m`;
  const date = formatDate(session.date, { weekday: "short", month: "numeric", day: "numeric" });
  return `<button class="session-row" type="button" data-action="open-session" data-session-id="${escapeHtml(session.id)}"><span class="session-day">${escapeHtml(date)}</span><span class="status-dot status-dot--${escapeHtml(session.status)}" aria-label="${escapeHtml(statusLabel(session.status))}"></span><span><span class="session-title">${escapeHtml(session.title)}</span><span class="session-detail">${escapeHtml(session.surface)} · ${escapeHtml(session.effortRaw)}</span></span><span class="session-duration">${escapeHtml(duration)}</span></button>`;
}

function phaseSuffix(sessions, week) {
  const phase = sessions.find((session) => session.weekNumber === week)?.phase;
  return phase && phase !== "build" ? ` · ${phase}` : "";
}

function renderProgress(goal) {
  const goals = visibleGoals(state);
  const installButton = installPrompt ? `<button class="primary-button button-block" type="button" data-action="install-app">Install app</button>` : "";
  let progressContent = `<article class="panel"><h2 id="progress-heading">No active plan</h2><p class="muted compact">Start a goal or import a plan. Hidden plans remain safely stored.</p></article>`;
  if (goal) {
    const summary = summarizeGoal(state, goal.id);
    const today = localDateKey();
    const countdown = goal.eventDate ? daysBetween(today, goal.eventDate) : null;
    const countdownText = Number.isFinite(countdown)
      ? (countdown >= 0 ? `${countdown} days to race` : "Goal date passed")
      : "No goal date";
    progressContent = `<p class="date-label" id="progress-heading">${escapeHtml(goal.title)} progress</p>${renderBackupReminder()}<article class="panel"><p class="eyebrow">Plan progress</p><h2>${summary.completedPlanCount} of ${summary.plannedCount} sessions complete</h2><div class="progress-track" role="progressbar" aria-label="Plan progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${summary.percent}"><div class="progress-bar" style="width:${summary.percent}%"></div></div><div class="progress-copy"><span>${summary.percent}% complete</span><span>${escapeHtml(countdownText)}</span></div></article><div class="stats-grid"><div class="stat"><div class="stat-value">${formatHours(summary.actualMinutes)}</div><div class="stat-label">Actual time</div></div><div class="stat"><div class="stat-value">${round(summary.actualMiles, 2)}</div><div class="stat-label">Logged miles</div></div><div class="stat"><div class="stat-value">${summary.longestMinutes}m</div><div class="stat-label">Longest</div></div></div>`;
  }
  const lastBackup = state.preferences.lastBackupAt
    ? `Last full backup: ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(state.preferences.lastBackupAt))}`
    : "No full backup downloaded from this device yet.";
  return `<section class="view" aria-labelledby="progress-heading">${progressContent}<article class="panel" id="data-panel"><p class="eyebrow">Your data</p><h2>Your phone is the working copy</h2><div class="privacy-line"><span class="privacy-mark" aria-hidden="true"></span><p class="muted compact">A backup JSON can fully restore Stridebook. A Sheets CSV is only a readable snapshot and does not sync back to the app.</p></div><p class="install-note">${escapeHtml(lastBackup)}</p><div class="button-grid"><button class="secondary-button" type="button" data-action="download-backup">Download backup</button><button class="secondary-button" type="button" data-action="import-data">Import plan/backup</button><button class="secondary-button" type="button" data-action="download-csv">Export Sheets CSV</button><button class="secondary-button" type="button" data-action="print-plan">Print / save PDF</button></div>${installButton}<button class="ghost-button button-block top-gap" type="button" data-route="help">How backups and plans work</button></article><article class="panel"><div class="section-heading no-margin"><p class="eyebrow compact">Visible goals</p><button class="ghost-button" type="button" data-route="new-goal">New goal</button></div><div class="goal-list">${goals.map(goalRow).join("") || `<p class="muted compact">No visible goals. Hidden goals can be restored from How it works.</p>`}</div></article><p class="quiet text-small">Stridebook ${APP_VERSION}</p></section>`;
}

function goalRow(goal) {
  const active = goal.id === state.activeGoalId;
  const dateText = goal.eventDate ? formatDate(goal.eventDate, { month: "short", day: "numeric", year: "numeric" }) : "No date";
  return `<div class="goal-row"><div><div class="goal-name">${escapeHtml(goal.title)}</div><div class="goal-detail">${escapeHtml(goal.distance || "Custom")} · ${escapeHtml(dateText)}</div></div><div class="goal-actions">${active ? `<span class="goal-active">Active</span>` : `<button class="ghost-button" type="button" data-action="set-active-goal" data-goal-id="${escapeHtml(goal.id)}">Open</button>`}<button class="ghost-button ghost-button--quiet" type="button" data-action="hide-goal" data-goal-id="${escapeHtml(goal.id)}">Hide</button></div></div>`;
}

function renderLocations() {
  const categories = [["all", "All"], ["smooth", "Smooth"], ["rolling", "Rolling"], ["hills", "Hills / hikes"]];
  const visible = state.locations.filter((locationItem) => locationFilter === "all" || locationItem.category === locationFilter);
  const hasPrivateDriveEstimates = state.locations.some((item) => /^~/.test(String(item.drive ?? "")));
  const heading = hasPrivateDriveEstimates ? "Closest useful options first" : "Trail and hill reference";
  const note = hasPrivateDriveEstimates
    ? "Drive estimates use a coarse neighborhood starting point, not your exact house, and are not live traffic. Verify routes and current closures before leaving."
    : "Use Directions from me for live travel time from your phone. Stridebook does not read or store your location.";
  return `<section class="view" aria-labelledby="locations-heading"><div class="section-heading"><button class="ghost-button" type="button" data-route="plan">← Plan</button><p class="date-label compact" id="locations-heading">${escapeHtml(heading)}</p></div><div class="filters" aria-label="Location type">${categories.map(([value, label]) => `<button class="filter-button ${locationFilter === value ? "is-active" : ""}" type="button" data-action="filter-locations" data-filter="${value}">${escapeHtml(label)}</button>`).join("")}</div>${visible.map(locationCard).join("")}<p class="quiet text-small">${escapeHtml(note)}</p></section>`;
}

function locationCard(locationItem) {
  const mapUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(locationItem.address)}&travelmode=driving`;
  const sourceUrl = safeExternalUrl(locationItem.sourceUrl);
  return `<article class="location-card"><div class="location-top"><div><p class="eyebrow">${escapeHtml(locationItem.categoryLabel)}</p><h2>${escapeHtml(locationItem.name)}</h2></div><span class="location-drive">${escapeHtml(locationItem.drive)}</span></div><div class="location-meta"><span>${escapeHtml(locationItem.address)}</span><span>${escapeHtml(locationItem.distance)}</span></div><p class="location-description">${escapeHtml(locationItem.description)}</p><div class="location-actions"><a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">Directions from me</a>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Official details</a>` : ""}</div></article>`;
}

function renderRoutines() {
  const hiddenIds = new Set(state.preferences.hiddenRoutineIds);
  const visible = state.routines.filter((routine) => !hiddenIds.has(routine.id));
  const hidden = state.routines.filter((routine) => hiddenIds.has(routine.id));
  return `<section class="view" aria-labelledby="routines-heading"><div class="section-heading"><button class="ghost-button" type="button" data-route="plan">← Plan</button><p class="date-label compact" id="routines-heading">Support the running plan</p></div><p class="muted">Strength can include lifting, mobility, balance, ankle work, or any other accessory routine that supports the goal.</p>${visible.map(routineCard).join("") || `<article class="panel"><h2>No strength routines yet</h2><p class="muted compact">Add your own below, or import a plan that includes strength work.</p></article>`}<article class="panel"><p class="eyebrow">Customize</p><h2>Add a routine</h2><form class="form-grid" id="custom-routine-form"><label class="form-label">Routine name<input class="form-control" name="name" maxlength="120" placeholder="Runner strength" required></label><label class="form-label">When or how long<input class="form-control" name="schedule" maxlength="500" placeholder="20 minutes after an easy run"></label><label class="form-label">Exercises, one per line<textarea class="form-control" name="exercises" maxlength="2000" placeholder="Goblet squat — 2 × 8&#10;Calf raise — 2 × 12" required></textarea></label><button class="primary-button button-block" type="submit">Add routine</button><p class="form-hint">Use a dash between the exercise and dose. Supplied routines can be hidden without deleting them.</p></form></article>${hidden.length ? `<article class="panel"><p class="eyebrow">Hidden routines</p><div class="goal-list">${hidden.map((routine) => `<div class="goal-row"><div class="goal-name">${escapeHtml(routine.name)}</div><button class="ghost-button" type="button" data-action="show-routine" data-routine-id="${escapeHtml(routine.id)}">Show</button></div>`).join("")}</div></article>` : ""}</section>`;
}

function routineCard(routine) {
  return `<article class="routine-card"><div class="section-heading no-margin"><div><p class="eyebrow">${escapeHtml(routine.durationText)}</p><h2>${escapeHtml(routine.name)}</h2></div><button class="ghost-button ghost-button--quiet" type="button" data-action="hide-routine" data-routine-id="${escapeHtml(routine.id)}">Hide</button></div>${routine.schedule ? `<p class="muted">${escapeHtml(routine.schedule)}</p>` : ""}<div class="exercise-list">${routine.exercises.map((exercise) => { const detail = [exercise.cue, exercise.purpose].filter(Boolean).join(" · "); return `<div class="exercise-row"><div class="exercise-top"><strong>${escapeHtml(exercise.name)}</strong><span class="exercise-dose">${escapeHtml(exercise.dose)}</span></div>${detail ? `<p class="exercise-cue">${escapeHtml(detail)}</p>` : ""}</div>`; }).join("")}</div>${routine.rules.length ? `<ul class="rule-list">${routine.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>` : ""}</article>`;
}

function renderNewGoal() {
  const defaultDate = futureDateKey(120);
  const visibleIds = new Set(visibleGoals(state).map((goal) => goal.id));
  const drafts = state.goals.filter((goal) => goal.status === "draft" && visibleIds.has(goal.id));
  return `<section class="view" aria-labelledby="new-goal-heading"><div class="section-heading"><button class="ghost-button" type="button" data-route="plan">← Plan</button><p class="date-label compact">One app, every future goal</p></div><article class="panel"><p class="eyebrow">Step 1 of 3</p><h2 id="new-goal-heading">Describe the goal</h2><form class="form-grid" id="new-goal-form"><label class="form-label">Goal or race<input class="form-control" name="name" autocomplete="off" placeholder="Spring 5K" required></label><div class="form-grid form-grid--two"><label class="form-label">Event date<input class="form-control" name="eventDate" type="date" value="${defaultDate}" required></label><label class="form-label">Run days per week<select class="form-control" name="runDays"><option value="2">2 days</option><option value="3">3 days</option><option value="4" selected>4 days</option></select></label></div><label class="form-label">Distance<select class="form-control" name="distance"><option>5K</option><option>10K</option><option>Half marathon</option><option>Marathon</option><option>50K</option><option>Custom</option></select></label><label class="form-label">Anything Codex should know<textarea class="form-control" name="planningNotes" maxlength="2000" placeholder="Currently run twice a week; longest recent run is 3 miles; available Tue, Thu, and Sun…"></textarea></label><button class="primary-button button-block" type="submit">Create goal request</button><p class="form-hint">Your existing goals and logs stay intact. Next, send the request to Codex and import the finished plan.</p></form></article>${drafts.length ? `<article class="panel"><p class="eyebrow">Waiting for a plan</p><div class="button-stack">${drafts.map((goal) => `<button class="secondary-button button-block" type="button" data-action="download-plan-request" data-goal-id="${escapeHtml(goal.id)}">Download request · ${escapeHtml(goal.title)}</button>`).join("")}</div></article>` : ""}</section>`;
}

function renderHelp() {
  const hiddenIds = new Set(state.preferences.hiddenGoalIds);
  const hiddenGoals = state.goals.filter((goal) => hiddenIds.has(goal.id));
  return `<section class="view" aria-labelledby="help-heading"><p class="date-label" id="help-heading">The simple version</p><article class="panel help-card"><span class="step-number">1</span><h2>Follow and log the plan</h2><p class="muted compact">Today shows what is next. A new imported plan becomes its own dated set of weekly workouts, with separate progress. Old goals remain available until you hide them.</p></article><article class="panel help-card"><span class="step-number">2</span><h2>Protect your runs</h2><p class="muted">Your phone is the working copy. A <strong>backup JSON</strong> contains goals, plans, logs, routines, and locations and can fully restore the app. Download one after every few logged runs.</p><button class="secondary-button button-block" type="button" data-action="download-backup">Download full backup</button><p class="form-hint">If Dropbox greys out a backup during import, download it to your phone’s Downloads folder first, then choose it from Files.</p></article><article class="panel help-card"><span class="step-number">3</span><h2>Use Google Sheets as a readable copy</h2><p class="muted compact">Export Sheets CSV makes a snapshot for Google Sheets. It is not live sync: editing the app does not update the Sheet, and editing the Sheet does not update Stridebook.</p></article><article class="panel help-card"><span class="step-number">4</span><h2>Start another goal</h2><p class="muted">Create a goal request, send the downloaded request to Codex, then import the plan JSON Codex returns. The plan itself is a set of dated workout cards grouped into weeks.</p><button class="primary-button button-block" type="button" data-route="new-goal">Start a new goal</button><button class="secondary-button button-block top-gap" type="button" data-action="import-data">Import plan or backup</button></article><article class="panel help-card"><span class="step-number">5</span><h2>Another runner gets separate data</h2><p class="muted compact">Someone else can install the same site on their phone and choose Start my own plan. Their goals and logs stay on their device and never mix with yours.</p></article>${hiddenGoals.length ? `<article class="panel"><p class="eyebrow">Hidden goals</p><div class="goal-list">${hiddenGoals.map((goal) => `<div class="goal-row"><div><div class="goal-name">${escapeHtml(goal.title)}</div><div class="goal-detail">Still stored on this device</div></div><button class="ghost-button" type="button" data-action="show-goal" data-goal-id="${escapeHtml(goal.id)}">Show</button></div>`).join("")}</div></article>` : ""}<p class="quiet text-small">Renaming the app or updating its code does not erase the on-device database.</p></section>`;
}

function renderNoGoal(title, copy) {
  return `<section class="view"><article class="panel"><p class="eyebrow">Stridebook</p><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(copy)}</p><div class="button-stack"><button class="primary-button button-block" type="button" data-route="new-goal">Start my own plan</button><button class="secondary-button button-block" type="button" data-action="import-data">Import plan or backup</button><button class="ghost-button button-block" type="button" data-route="help">How it works</button></div></article></section>`;
}

function handleClick(event) {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    navigate(routeButton.dataset.route);
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === "open-data") navigate("help");
  if (action === "open-session") openSessionDialog(actionButton.dataset.sessionId);
  if (action === "open-extra-workout") openSessionDialog(null, true);
  if (action === "close-dialog") sessionDialog.close();
  if (action === "previous-week") changeWeek(-1);
  if (action === "next-week") changeWeek(1);
  if (action === "filter-locations") { locationFilter = actionButton.dataset.filter; render(); }
  if (action === "download-backup") void downloadBackup().catch((error) => showToast(error.message));
  if (action === "download-csv") downloadText(`stridebook-workouts-${localDateKey()}.csv`, toWorkoutCsv(state), "text/csv;charset=utf-8");
  if (action === "import-data") importFile.click();
  if (action === "print-plan") window.print();
  if (action === "download-plan-request") downloadJson(`${actionButton.dataset.goalId}-plan-request.json`, buildPlanRequest(state, actionButton.dataset.goalId));
  if (action === "set-active-goal") void setActiveGoal(actionButton.dataset.goalId).catch((error) => showToast(error.message));
  if (action === "hide-goal") void hideGoal(actionButton.dataset.goalId).catch((error) => showToast(error.message));
  if (action === "show-goal") void showGoal(actionButton.dataset.goalId).catch((error) => showToast(error.message));
  if (action === "hide-routine") void hideRoutine(actionButton.dataset.routineId).catch((error) => showToast(error.message));
  if (action === "show-routine") void showRoutine(actionButton.dataset.routineId).catch((error) => showToast(error.message));
  if (action === "use-fall-creek") void finishOnboarding(false).catch((error) => showToast(error.message));
  if (action === "start-own-plan") void finishOnboarding(true).catch((error) => showToast(error.message));
  if (action === "install-app") void promptInstall();
}

function handleChange(event) {
  if (event.target.matches('[data-role="week-select"]')) {
    selectedWeek = Number(event.target.value);
    render();
  }
  if (event.target.matches('[data-role="goal-select"]')) void setActiveGoal(event.target.value).catch((error) => showToast(error.message));
}

async function handleSubmit(event) {
  try {
    if (event.target.id === "session-log-form") {
      event.preventDefault();
      await saveSessionForm(new FormData(event.target));
    }
    if (event.target.id === "new-goal-form") {
      event.preventDefault();
      await saveNewGoal(new FormData(event.target));
    }
    if (event.target.id === "custom-routine-form") {
      event.preventDefault();
      await saveCustomRoutine(new FormData(event.target));
    }
  } catch (error) {
    showToast(error.message || "That change could not be saved.");
  }
}

function openSessionDialog(sessionId, isExtra = false) {
  const session = sessionId ? state.sessions.find((item) => item.id === sessionId) : null;
  if (sessionId && !session) return showToast("Workout not found.");
  const status = session && session.status !== "planned" ? session.status : "done";
  const title = isExtra ? "Extra run" : session.title;
  sessionDialogContent.innerHTML = `<div class="dialog-inner"><div class="dialog-handle" aria-hidden="true"></div><p class="eyebrow">${isExtra ? escapeHtml(formatDate(localDateKey())) : escapeHtml(formatDate(session.date))}</p><h2 id="session-dialog-title">${escapeHtml(title)}</h2>${session ? `<p class="muted">${escapeHtml(instructionOnly(session.workoutText))}</p>` : ""}<form class="form-grid" id="session-log-form"><input type="hidden" name="sessionId" value="${escapeHtml(session?.id ?? "")}"><input type="hidden" name="isExtra" value="${isExtra ? "yes" : "no"}">${isExtra ? `<label class="form-label">Workout name<input class="form-control" name="title" value="Easy run" required></label>` : ""}<label class="form-label">Status<select class="form-control" name="status"><option value="done" ${status === "done" ? "selected" : ""}>Done</option><option value="adjusted" ${status === "adjusted" ? "selected" : ""}>Adjusted</option><option value="skipped" ${status === "skipped" ? "selected" : ""}>Skipped</option><option value="planned">Planned / clear log</option></select></label><div class="form-grid form-grid--two"><label class="form-label">Actual minutes<input class="form-control" name="actualMinutes" type="number" min="0" max="1440" inputmode="numeric" value="${escapeHtml(session?.log?.actualMinutes ?? session?.planMinutes ?? "")}"></label><label class="form-label">Actual miles<input class="form-control" name="actualMiles" type="number" min="0" max="200" step="0.01" inputmode="decimal" value="${escapeHtml(session?.log?.actualMiles ?? "")}" placeholder="Optional"></label></div><label class="form-label">One short note<textarea class="form-control" name="notes" maxlength="500" placeholder="Felt easy, ankle good…">${escapeHtml(session?.log?.notes ?? "")}</textarea></label><div class="dialog-actions"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="primary-button" type="submit">Save</button></div></form></div>`;
  sessionDialog.showModal();
  sessionDialog.querySelector("select")?.focus();
}

async function saveSessionForm(formData) {
  const next = structuredClone(state);
  const isExtra = formData.get("isExtra") === "yes";
  const status = String(formData.get("status"));
  const actualMinutes = optionalNumber(formData.get("actualMinutes"), 0, 1440, "Minutes");
  const actualMiles = optionalNumber(formData.get("actualMiles"), 0, 200, "Miles");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 500);
  let session;

  if (isExtra) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) throw new Error("Enter a workout name.");
    session = {
      id: `extra-${uniqueId()}`,
      goalId: next.activeGoalId,
      sourceRow: null,
      weekNumber: weekForDate(sessionsForGoal(next), localDateKey()),
      weekLabel: "Extra",
      phase: "extra",
      date: localDateKey(),
      title,
      workoutText: title,
      planMinutes: null,
      effortRaw: "",
      rpeMin: null,
      rpeMax: null,
      surface: "",
      type: "easy",
      status,
      log: null,
    };
    next.sessions.push(session);
  } else {
    session = next.sessions.find((item) => item.id === formData.get("sessionId"));
    if (!session) throw new Error("Workout not found.");
  }

  session.status = status;
  session.log = status === "planned" ? null : { actualMinutes, actualMiles, notes, completedAt: new Date().toISOString() };
  next.preferences.changesSinceBackup = Math.min(100_000, next.preferences.changesSinceBackup + 1);
  next.revision += 1;
  await commitState(next);
  sessionDialog.close();
  showToast(status === "planned" ? "Workout returned to planned." : "Workout saved on this device.");
}

async function saveNewGoal(formData) {
  const goal = createDraftGoal({ name: formData.get("name"), eventDate: formData.get("eventDate"), distance: formData.get("distance"), runDays: formData.get("runDays"), planningNotes: formData.get("planningNotes") }, state.goals);
  const next = structuredClone(state);
  next.goals.push(goal);
  next.activeGoalId = goal.id;
  next.preferences.onboardingComplete = true;
  next.preferences.hiddenGoalIds = next.preferences.hiddenGoalIds.filter((id) => id !== goal.id);
  next.revision += 1;
  await commitState(next);
  navigate("plan");
  showToast("Goal saved. Download its request to create the plan.");
}

async function setActiveGoal(goalId) {
  if (!state.goals.some((goal) => goal.id === goalId)) return;
  const next = structuredClone(state);
  next.activeGoalId = goalId;
  next.preferences.hiddenGoalIds = next.preferences.hiddenGoalIds.filter((id) => id !== goalId);
  next.revision += 1;
  selectedWeek = weekForDate(sessionsForGoal(next, goalId), localDateKey());
  await commitState(next);
  navigate("plan");
}

async function finishOnboarding(startOwnPlan) {
  const next = structuredClone(state);
  next.preferences.onboardingComplete = true;
  const starterGoalId = planPackage?.goal?.id;
  if (startOwnPlan && starterGoalId) {
    next.preferences.hiddenGoalIds = [...new Set([...next.preferences.hiddenGoalIds, starterGoalId])];
    next.preferences.hiddenRoutineIds = [...new Set([...next.preferences.hiddenRoutineIds, ...next.routines.map((routine) => routine.id)])];
    if (next.activeGoalId === starterGoalId) next.activeGoalId = null;
  } else if (starterGoalId) {
    next.preferences.hiddenGoalIds = next.preferences.hiddenGoalIds.filter((id) => id !== starterGoalId);
    next.activeGoalId = starterGoalId;
  }
  next.revision += 1;
  await commitState(next);
  navigate(startOwnPlan ? "new-goal" : "today");
}

async function hideGoal(goalId) {
  if (!state.goals.some((goal) => goal.id === goalId)) return;
  const next = structuredClone(state);
  next.preferences.hiddenGoalIds = [...new Set([...next.preferences.hiddenGoalIds, goalId])];
  if (next.activeGoalId === goalId) {
    next.activeGoalId = next.goals.find((goal) => !next.preferences.hiddenGoalIds.includes(goal.id))?.id ?? null;
  }
  next.revision += 1;
  await commitState(next);
  selectedWeek = weekForDate(sessionsForGoal(state), localDateKey());
  showToast("Goal hidden. You can restore it from How it works.");
}

async function showGoal(goalId) {
  if (!state.goals.some((goal) => goal.id === goalId)) return;
  const next = structuredClone(state);
  next.preferences.hiddenGoalIds = next.preferences.hiddenGoalIds.filter((id) => id !== goalId);
  next.activeGoalId = goalId;
  next.revision += 1;
  await commitState(next);
  selectedWeek = weekForDate(sessionsForGoal(state, goalId), localDateKey());
  navigate("plan");
  showToast("Goal restored.");
}

async function hideRoutine(routineId) {
  if (!state.routines.some((routine) => routine.id === routineId)) return;
  const next = structuredClone(state);
  next.preferences.hiddenRoutineIds = [...new Set([...next.preferences.hiddenRoutineIds, routineId])];
  next.revision += 1;
  await commitState(next);
  showToast("Strength routine hidden.");
}

async function showRoutine(routineId) {
  if (!state.routines.some((routine) => routine.id === routineId)) return;
  const next = structuredClone(state);
  next.preferences.hiddenRoutineIds = next.preferences.hiddenRoutineIds.filter((id) => id !== routineId);
  next.revision += 1;
  await commitState(next);
  showToast("Strength routine restored.");
}

async function saveCustomRoutine(formData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const schedule = String(formData.get("schedule") ?? "").trim().slice(0, 500);
  const exerciseLines = String(formData.get("exercises") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (!name) throw new Error("Enter a routine name.");
  if (!exerciseLines.length) throw new Error("Enter at least one exercise.");
  const exercises = exerciseLines.map((line) => {
    const parts = line.split(/\s+(?:—|–|-|\|)\s+/);
    return {
      name: parts.shift()?.trim().slice(0, 200) || "Exercise",
      dose: parts.join(" — ").trim().slice(0, 200) || "As planned",
      cue: "",
      purpose: "",
    };
  });
  const next = structuredClone(state);
  next.routines.push({
    id: `custom-routine-${uniqueId()}`,
    name,
    durationText: "Custom routine",
    schedule,
    exercises,
    rules: [],
  });
  next.revision += 1;
  await commitState(next);
  showToast("Strength routine added.");
}

function changeWeek(direction) {
  const weeks = [...new Set(sessionsForGoal(state).map((session) => session.weekNumber).filter(Boolean))].sort((a, b) => a - b);
  const index = Math.max(0, weeks.indexOf(selectedWeek));
  const nextIndex = Math.min(weeks.length - 1, Math.max(0, index + direction));
  selectedWeek = weeks[nextIndex] ?? selectedWeek;
  render();
}

async function handleImportFile() {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  if (file.size > 2_000_000) return showToast("That file is too large to be a Stridebook file.");
  try {
    const input = JSON.parse(await file.text());
    if (input.format === BACKUP_FORMAT) {
      validateBackup(input);
      if (!confirm("Restore this backup? Your current device data will be downloaded first, then replaced.")) return;
      downloadJson(`stridebook-before-restore-${localDateKey()}.json`, toBackup(state));
      const restored = normalizeState(input.state);
      restored.revision = state.revision + 1;
      restored.preferences.onboardingComplete = true;
      restored.preferences.lastBackupAt = new Date().toISOString();
      restored.preferences.changesSinceBackup = 0;
      await commitState(restored);
      selectedWeek = weekForDate(sessionsForGoal(state), localDateKey());
      showToast("Backup restored.");
      return;
    }
    if (input.format === PLAN_FORMAT) {
      const imported = importPlan(state, input);
      imported.preferences.onboardingComplete = true;
      await commitState(imported);
      selectedWeek = weekForDate(sessionsForGoal(state), localDateKey());
      navigate("plan");
      showToast("New plan imported.");
      return;
    }
    throw new Error("Choose a Stridebook plan or backup JSON file.");
  } catch (error) {
    showToast(error.message || "That file could not be imported.");
  }
}

async function downloadBackup() {
  downloadJson(`stridebook-backup-${localDateKey()}.json`, toBackup(state));
  const next = structuredClone(state);
  next.preferences.lastBackupAt = new Date().toISOString();
  next.preferences.changesSinceBackup = 0;
  next.revision += 1;
  await commitState(next);
  showToast("Full backup downloaded.");
}

async function commitState(next) {
  const previousRevision = state.revision;
  const candidate = normalizeState(next);
  if (persistentStorage) {
    try {
      await saveState(candidate, previousRevision);
    } catch (error) {
      if (error instanceof StaleStateError) {
        state = normalizeState(await loadState());
        render();
        throw new Error("Another open tab changed your training log. It has been refreshed; please try again.");
      }
      showStorageWarning("This change was not saved. Download a backup before closing the app.");
      throw error;
    }
  }
  state = candidate;
  broadcast?.postMessage({ revision: candidate.revision });
  render();
}

async function promptInstall() {
  if (!installPrompt) return showToast("Use Chrome’s menu and choose Install app.");
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  render();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Offline setup failed", error));
}

function downloadJson(filename, value) {
  downloadText(filename, `${JSON.stringify(value, null, 2)}\n`, "application/json");
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function optionalNumber(value, minimum, maximum, label) {
  if (value === null || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  return number;
}

function instructionOnly(text) {
  const value = String(text ?? "");
  const separator = value.indexOf(":");
  return separator === -1 ? value : value.slice(separator + 1).trim();
}

function logSummary(log) {
  const parts = [];
  if (Number.isFinite(Number(log.actualMinutes))) parts.push(`${log.actualMinutes} min`);
  if (Number.isFinite(Number(log.actualMiles))) parts.push(`${log.actualMiles} mi`);
  if (log.notes) parts.push(log.notes);
  return parts.join(" · ") || "No details entered";
}

function formatHours(minutes) {
  const value = Number(minutes) || 0;
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function futureDateKey(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function uniqueId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function emptyPanel(title, copy) {
  return `<section class="view"><article class="panel"><h2>${escapeHtml(title)}</h2><p class="muted compact">${escapeHtml(copy)}</p></article></section>`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
}

function showStorageWarning(message = "Device storage is unavailable. Changes will last only until this page closes.") {
  storageWarning.textContent = message;
  storageWarning.hidden = false;
}
