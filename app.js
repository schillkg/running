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

const validRoutes = new Set(["today", "plan", "progress", "locations", "routines", "new-goal"]);

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
    showToast("My Training is installed.");
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
  const route = routeName();
  const goal = activeGoal(state);
  headerEyebrow.textContent = headerLabel(route, goal);
  headerTitle.textContent = route === "locations" ? "Run locations" : route === "routines" ? "Routines" : route === "new-goal" ? "New goal" : "My Training";
  setActiveNav(route);

  if (route === "today") main.innerHTML = renderToday(goal);
  if (route === "plan") main.innerHTML = renderPlan(goal);
  if (route === "progress") main.innerHTML = renderProgress(goal);
  if (route === "locations") main.innerHTML = renderLocations();
  if (route === "routines") main.innerHTML = renderRoutines();
  if (route === "new-goal") main.innerHTML = renderNewGoal();
}

function headerLabel(route, goal) {
  if (route === "locations") return "Plan reference";
  if (route === "routines") return "Strength + stability";
  if (route === "new-goal") return "Future training";
  return goal?.title ?? "Running plan";
}

function setActiveNav(route) {
  const active = route === "locations" || route === "routines" || route === "new-goal" ? "plan" : route;
  for (const button of navButtons) {
    const selected = button.dataset.route === active;
    button.classList.toggle("is-active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function renderToday(goal) {
  if (!goal) return emptyPanel("No training goal yet", "Create or import a goal from the Plan tab.");
  const today = localDateKey();
  const sessions = sessionsForGoal(state, goal.id);
  const todaySessions = sessions.filter((session) => session.date === today);
  const next = nextSession(sessions, today, todaySessions.length === 0);
  const countdown = goal.eventDate ? daysBetween(today, goal.eventDate) : null;

  const todayContent = todaySessions.length
    ? todaySessions.map((session) => workoutCard(session, true)).join("")
    : `<article class="workout-card"><p class="eyebrow">Today</p><h2>No run scheduled</h2><p class="muted compact">Upper body, rest, or the optional ankle routine.</p></article>`;

  const nextContent = next && !todaySessions.some((session) => session.id === next.id)
    ? `<article class="workout-card workout-card--primary"><p class="eyebrow">Next workout · ${escapeHtml(formatDate(next.date, { weekday: "long" }))}</p><h2>${escapeHtml(next.title)}</h2>${workoutMeta(next)}<p class="workout-text">${escapeHtml(instructionOnly(next.workoutText))}</p><button class="primary-button button-block" type="button" data-action="open-session" data-session-id="${escapeHtml(next.id)}">Log workout</button></article>`
    : "";

  return `<section class="view" aria-labelledby="today-date"><p class="date-label" id="today-date">${escapeHtml(formatDate(today))}</p>${todayContent}${nextContent}<div class="button-grid"><button class="secondary-button" type="button" data-action="open-extra-workout">Log extra run</button><button class="secondary-button" type="button" data-route="routines">Ankle routine</button></div>${Number.isFinite(countdown) && countdown >= 0 ? `<p class="install-note">${countdown === 0 ? "Race day" : `${countdown} days until ${escapeHtml(goal.title)}`}.</p>` : ""}</section>`;
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
  if (!goal) return emptyPanel("No training goal yet", "Create a new goal to begin.");
  const goals = state.goals;
  const sessions = sessionsForGoal(state, goal.id);
  const weeks = [...new Set(sessions.map((session) => session.weekNumber).filter(Boolean))].sort((a, b) => a - b);
  if (!weeks.includes(selectedWeek)) selectedWeek = weekForDate(sessions, localDateKey()) ?? weeks[0] ?? null;
  const weekSessions = sessions.filter((session) => session.weekNumber === selectedWeek);
  const weekPhase = weekSessions[0]?.phase;

  const goalPicker = goals.length > 1
    ? `<label class="form-label">Training goal<select class="goal-select" data-role="goal-select">${goals.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === goal.id ? "selected" : ""}>${escapeHtml(item.title)}${item.status === "draft" ? " · draft" : ""}</option>`).join("")}</select></label>`
    : "";

  if (goal.status === "draft" || !sessions.length) {
    return `<section class="view"><div class="section-heading"><p class="date-label compact">Draft goal</p><button class="ghost-button" type="button" data-route="new-goal">New goal</button></div>${goalPicker}<article class="panel"><p class="eyebrow">${escapeHtml(goal.distance || "Custom")}</p><h2>${escapeHtml(goal.title)}</h2><p>${escapeHtml(formatDate(goal.eventDate))}</p><p class="muted">This goal is saved. Download its plan request, send it to Codex, then import the resulting plan file here.</p><button class="primary-button button-block" type="button" data-action="download-plan-request" data-goal-id="${escapeHtml(goal.id)}">Download plan request</button></article>${referenceButtons()}</section>`;
  }

  return `<section class="view" aria-labelledby="plan-heading"><div class="section-heading"><div><p class="date-label compact" id="plan-heading">${escapeHtml(goal.subtitle || goal.title)}</p></div><button class="ghost-button" type="button" data-route="new-goal">New goal</button></div>${goalPicker}<div class="week-picker"><button class="week-arrow" type="button" data-action="previous-week" aria-label="Previous week">‹</button><select class="week-select" data-role="week-select" aria-label="Training week">${weeks.map((week) => `<option value="${week}" ${week === selectedWeek ? "selected" : ""}>Week ${week}${escapeHtml(phaseSuffix(sessions, week))}</option>`).join("")}</select><button class="week-arrow" type="button" data-action="next-week" aria-label="Next week">›</button></div><article class="panel"><p class="eyebrow">Week ${selectedWeek}${weekPhase && weekPhase !== "build" ? ` · ${escapeHtml(weekPhase)}` : ""}</p><div class="session-list">${weekSessions.map(sessionRow).join("") || `<p class="muted compact">No workouts in this week.</p>`}</div></article>${referenceButtons()}</section>`;
}

function referenceButtons() {
  return `<div class="reference-grid" aria-label="Plan references"><button class="reference-button" type="button" data-route="locations">Run locations</button><button class="reference-button" type="button" data-route="routines">Strength + ankle</button><button class="reference-button reference-button--wide" type="button" data-route="progress">Backup + progress</button></div>`;
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
  if (!goal) return emptyPanel("No training goal yet", "Create or import a goal first.");
  const summary = summarizeGoal(state, goal.id);
  const today = localDateKey();
  const countdown = goal.eventDate ? daysBetween(today, goal.eventDate) : null;
  const countdownText = Number.isFinite(countdown)
    ? (countdown >= 0 ? `${countdown} days to race` : "Goal date passed")
    : "No goal date";
  const installButton = installPrompt ? `<button class="primary-button button-block" type="button" data-action="install-app">Install app</button>` : "";

  return `<section class="view" aria-labelledby="progress-heading"><p class="date-label" id="progress-heading">${escapeHtml(goal.title)} progress</p><article class="panel"><p class="eyebrow">Plan progress</p><h2>${summary.completedPlanCount} of ${summary.plannedCount} sessions complete</h2><div class="progress-track" role="progressbar" aria-label="Plan progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${summary.percent}"><div class="progress-bar" style="width:${summary.percent}%"></div></div><div class="progress-copy"><span>${summary.percent}% complete</span><span>${escapeHtml(countdownText)}</span></div></article><div class="stats-grid"><div class="stat"><div class="stat-value">${formatHours(summary.actualMinutes)}</div><div class="stat-label">Actual time</div></div><div class="stat"><div class="stat-value">${round(summary.actualMiles, 2)}</div><div class="stat-label">Logged miles</div></div><div class="stat"><div class="stat-value">${summary.longestMinutes}m</div><div class="stat-label">Longest</div></div></div><article class="panel" id="data-panel"><p class="eyebrow">Your data</p><h2>Stored on this device</h2><div class="privacy-line"><span class="privacy-mark" aria-hidden="true"></span><p class="muted compact">Workout logs stay in this browser. The public app files contain no personal workout history.</p></div><div class="button-grid"><button class="secondary-button" type="button" data-action="download-backup">Download backup</button><button class="secondary-button" type="button" data-action="import-data">Import plan/backup</button><button class="secondary-button" type="button" data-action="download-csv">Export Sheets CSV</button><button class="secondary-button" type="button" data-action="print-plan">Print / save PDF</button></div>${installButton}<p class="install-note">For Android, open this site in Chrome and choose <strong>Install app</strong> from Chrome’s menu if the button is not shown here.</p></article><article class="panel"><p class="eyebrow">Goals</p><div class="goal-list">${state.goals.map(goalRow).join("")}</div></article><p class="quiet text-small">My Training ${APP_VERSION}</p></section>`;
}

function goalRow(goal) {
  const active = goal.id === state.activeGoalId;
  const dateText = goal.eventDate ? formatDate(goal.eventDate, { month: "short", day: "numeric", year: "numeric" }) : "No date";
  return `<div class="goal-row"><div><div class="goal-name">${escapeHtml(goal.title)}</div><div class="goal-detail">${escapeHtml(goal.distance || "Custom")} · ${escapeHtml(dateText)}</div></div>${active ? `<span class="goal-active">Active</span>` : `<button class="ghost-button" type="button" data-action="set-active-goal" data-goal-id="${escapeHtml(goal.id)}">Open</button>`}</div>`;
}

function renderLocations() {
  const categories = [["all", "All"], ["smooth", "Smooth"], ["rolling", "Rolling"], ["hills", "Hills / hikes"]];
  const visible = state.locations.filter((locationItem) => locationFilter === "all" || locationItem.category === locationFilter);
  const hasPrivateDriveEstimates = state.locations.some((item) => /^~/.test(String(item.drive ?? "")));
  const heading = hasPrivateDriveEstimates ? "Closest useful options first" : "Trail and hill reference";
  const note = hasPrivateDriveEstimates
    ? "Drive estimates use a coarse neighborhood starting point, not your exact house, and are not live traffic. Verify routes and current closures before leaving."
    : "Open the map for current travel time. Import your private starter backup to add the neighborhood-based estimates.";
  return `<section class="view" aria-labelledby="locations-heading"><div class="section-heading"><button class="ghost-button" type="button" data-route="plan">← Plan</button><p class="date-label compact" id="locations-heading">${escapeHtml(heading)}</p></div><div class="filters" aria-label="Location type">${categories.map(([value, label]) => `<button class="filter-button ${locationFilter === value ? "is-active" : ""}" type="button" data-action="filter-locations" data-filter="${value}">${escapeHtml(label)}</button>`).join("")}</div>${visible.map(locationCard).join("")}<p class="quiet text-small">${escapeHtml(note)}</p></section>`;
}

function locationCard(locationItem) {
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationItem.address)}`;
  const sourceUrl = safeExternalUrl(locationItem.sourceUrl);
  return `<article class="location-card"><div class="location-top"><div><p class="eyebrow">${escapeHtml(locationItem.categoryLabel)}</p><h2>${escapeHtml(locationItem.name)}</h2></div><span class="location-drive">${escapeHtml(locationItem.drive)}</span></div><div class="location-meta"><span>${escapeHtml(locationItem.address)}</span><span>${escapeHtml(locationItem.distance)}</span></div><p class="location-description">${escapeHtml(locationItem.description)}</p><div class="location-actions"><a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">Open map</a>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Official details</a>` : ""}</div></article>`;
}

function renderRoutines() {
  return `<section class="view" aria-labelledby="routines-heading"><div class="section-heading"><button class="ghost-button" type="button" data-route="plan">← Plan</button><p class="date-label compact" id="routines-heading">Keep Sunday protected</p></div>${state.routines.map(routineCard).join("")}</section>`;
}

function routineCard(routine) {
  return `<article class="routine-card"><p class="eyebrow">${escapeHtml(routine.durationText)}</p><h2>${escapeHtml(routine.name)}</h2><p class="muted">${escapeHtml(routine.schedule)}</p><div class="exercise-list">${routine.exercises.map((exercise) => `<div class="exercise-row"><div class="exercise-top"><strong>${escapeHtml(exercise.name)}</strong><span class="exercise-dose">${escapeHtml(exercise.dose)}</span></div><p class="exercise-cue">${escapeHtml(exercise.cue)} · ${escapeHtml(exercise.purpose)}</p></div>`).join("")}</div><ul class="rule-list">${routine.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul></article>`;
}

function renderNewGoal() {
  const defaultDate = futureDateKey(120);
  const drafts = state.goals.filter((goal) => goal.status === "draft");
  return `<section class="view" aria-labelledby="new-goal-heading"><div class="section-heading"><button class="ghost-button" type="button" data-route="plan">← Plan</button><p class="date-label compact">One app, every future goal</p></div><article class="panel"><p class="eyebrow">New goal</p><h2 id="new-goal-heading">Start your next plan</h2><form class="form-grid" id="new-goal-form"><label class="form-label">Goal or race<input class="form-control" name="name" autocomplete="off" placeholder="Spring half marathon" required></label><div class="form-grid form-grid--two"><label class="form-label">Event date<input class="form-control" name="eventDate" type="date" value="${defaultDate}" required></label><label class="form-label">Run days per week<select class="form-control" name="runDays"><option value="2">2 days</option><option value="3">3 days</option><option value="4" selected>4 days</option></select></label></div><label class="form-label">Distance<select class="form-control" name="distance"><option>5K</option><option>10K</option><option>Half marathon</option><option>Marathon</option><option>50K</option><option>Custom</option></select></label><button class="primary-button button-block" type="submit">Create goal</button><p class="form-hint">This saves the goal without replacing your current plan. Codex can use the request file and your recent log to create the new plan.</p></form></article>${drafts.length ? `<article class="panel"><p class="eyebrow">Draft goals</p><div class="button-stack">${drafts.map((goal) => `<button class="secondary-button button-block" type="button" data-action="download-plan-request" data-goal-id="${escapeHtml(goal.id)}">Download request · ${escapeHtml(goal.title)}</button>`).join("")}</div></article>` : ""}</section>`;
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
  if (action === "open-data") navigate("progress");
  if (action === "open-session") openSessionDialog(actionButton.dataset.sessionId);
  if (action === "open-extra-workout") openSessionDialog(null, true);
  if (action === "close-dialog") sessionDialog.close();
  if (action === "previous-week") changeWeek(-1);
  if (action === "next-week") changeWeek(1);
  if (action === "filter-locations") { locationFilter = actionButton.dataset.filter; render(); }
  if (action === "download-backup") downloadJson(`my-training-backup-${localDateKey()}.json`, toBackup(state));
  if (action === "download-csv") downloadText(`my-training-workouts-${localDateKey()}.csv`, toWorkoutCsv(state), "text/csv;charset=utf-8");
  if (action === "import-data") importFile.click();
  if (action === "print-plan") window.print();
  if (action === "download-plan-request") downloadJson(`${actionButton.dataset.goalId}-plan-request.json`, buildPlanRequest(state, actionButton.dataset.goalId));
  if (action === "set-active-goal") void setActiveGoal(actionButton.dataset.goalId).catch((error) => showToast(error.message));
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
  next.revision += 1;
  await commitState(next);
  sessionDialog.close();
  showToast(status === "planned" ? "Workout returned to planned." : "Workout saved on this device.");
}

async function saveNewGoal(formData) {
  const goal = createDraftGoal({ name: formData.get("name"), eventDate: formData.get("eventDate"), distance: formData.get("distance"), runDays: formData.get("runDays") }, state.goals);
  const next = structuredClone(state);
  next.goals.push(goal);
  next.revision += 1;
  await commitState(next);
  showToast("Goal saved. Its plan request is ready below.");
}

async function setActiveGoal(goalId) {
  if (!state.goals.some((goal) => goal.id === goalId)) return;
  const next = structuredClone(state);
  next.activeGoalId = goalId;
  next.revision += 1;
  selectedWeek = weekForDate(sessionsForGoal(next, goalId), localDateKey());
  await commitState(next);
  navigate("plan");
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
  if (file.size > 2_000_000) return showToast("That file is too large to be a My Training file.");
  try {
    const input = JSON.parse(await file.text());
    if (input.format === BACKUP_FORMAT) {
      validateBackup(input);
      if (!confirm("Restore this backup? Your current device data will be downloaded first, then replaced.")) return;
      downloadJson(`my-training-before-restore-${localDateKey()}.json`, toBackup(state));
      const restored = normalizeState(input.state);
      restored.revision = state.revision + 1;
      await commitState(restored);
      selectedWeek = weekForDate(sessionsForGoal(state), localDateKey());
      showToast("Backup restored.");
      return;
    }
    if (input.format === PLAN_FORMAT) {
      await commitState(importPlan(state, input));
      selectedWeek = weekForDate(sessionsForGoal(state), localDateKey());
      navigate("plan");
      showToast("New plan imported.");
      return;
    }
    throw new Error("Choose a My Training plan or backup JSON file.");
  } catch (error) {
    showToast(error.message || "That file could not be imported.");
  }
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
