const STORAGE_KEY = "gym-timer-state-v1";
const SAMPLE_WORKOUT = `Barbell Bench Press | 4 | 8 | 90
Incline Dumbbell Press | 3 | 10 | 75
Cable Fly | 3 | 12 | 60`;

const input = document.querySelector("#workout-input");
const message = document.querySelector("#message");
const workoutCard = document.querySelector("#workout-card");
const progressText = document.querySelector("#progress-text");
const runnerPanel = document.querySelector("#runner-panel");
const promptBox = document.querySelector("#prompt-box");
const loadWorkoutButton = document.querySelector("#load-workout");
const loadSampleButton = document.querySelector("#load-sample");
const copyPromptButton = document.querySelector("#copy-prompt");
const clearWorkoutButton = document.querySelector("#clear-workout");
const previousSetButton = document.querySelector("#previous-set");
const completeSetButton = document.querySelector("#complete-set");
const skipRestButton = document.querySelector("#skip-rest");

let state = loadStoredState();
let countdownInterval = null;

if (state.rawInput) {
  input.value = state.rawInput;
}

render();
syncTimer();

loadWorkoutButton.addEventListener("click", () => {
  try {
    const exercises = parseWorkout(input.value);
    state = createSessionState(exercises, input.value);
    saveState();
    setMessage(`Loaded ${exercises.length} exercise${exercises.length === 1 ? "" : "s"}.`, "success");
    render();
    syncTimer();
    focusRunner();
  } catch (error) {
    setMessage(error.message, "error");
  }
});

loadSampleButton.addEventListener("click", () => {
  input.value = SAMPLE_WORKOUT;
  setMessage("Sample workout inserted.", "success");
});

copyPromptButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(promptBox.innerText.trim());
    setMessage("Prompt copied.", "success");
  } catch {
    setMessage("Could not copy automatically. Copy the prompt manually.", "error");
  }
});

clearWorkoutButton.addEventListener("click", () => {
  stopCountdown();
  state = defaultState();
  input.value = "";
  saveState();
  setMessage("Workout reset.", "success");
  render();
});

previousSetButton.addEventListener("click", () => {
  if (!hasWorkoutLoaded() || isAtFirstSet()) {
    return;
  }

  goToPreviousSet();
  saveState();
  setMessage("Moved back to the previous set.", "success");
  render();
  syncTimer();
});

completeSetButton.addEventListener("click", () => {
  if (!hasWorkoutLoaded() || state.mode === "rest") {
    return;
  }

  const currentExercise = state.exercises[state.exerciseIndex];
  const isLastSetInExercise = state.setIndex === currentExercise.sets - 1;
  const isLastExercise = state.exerciseIndex === state.exercises.length - 1;

  if (isLastSetInExercise && isLastExercise) {
    stopCountdown();
    state.mode = "done";
    state.completedAt = Date.now();
    saveState();
    setMessage("Workout complete.", "success");
    render();
    return;
  }

  state.mode = "rest";
  state.restEndsAt = Date.now() + currentExercise.restSeconds * 1000;
  saveState();
  setMessage(`Rest started for ${currentExercise.restSeconds} seconds.`, "success");
  render();
  syncTimer();
});

skipRestButton.addEventListener("click", () => {
  if (!hasWorkoutLoaded()) {
    return;
  }

  if (state.mode === "rest") {
    advanceAfterRest();
    setMessage("Rest skipped.", "success");
    return;
  }

  if (state.mode === "done") {
    state = defaultState();
    input.value = "";
    saveState();
    setMessage("Ready for a new workout.", "success");
    render();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    syncTimer();
    render();
  }
});

function defaultState() {
  return {
    rawInput: "",
    exercises: [],
    exerciseIndex: 0,
    setIndex: 0,
    mode: "idle",
    restEndsAt: null,
    completedAt: null
  };
}

function createSessionState(exercises, rawInput) {
  return {
    rawInput,
    exercises,
    exerciseIndex: 0,
    setIndex: 0,
    mode: "active",
    restEndsAt: null,
    completedAt: null
  };
}

function parseWorkout(rawText) {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("Paste at least one exercise line.");
  }

  return lines.map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());

    if (parts.length !== 4) {
      throw new Error(`Line ${index + 1} must have exactly 4 parts separated by "|".`);
    }

    const [name, setsRaw, repsRaw, restRaw] = parts;
    const sets = Number.parseInt(setsRaw, 10);
    const reps = Number.parseInt(repsRaw, 10);
    const restSeconds = Number.parseInt(restRaw, 10);

    if (!name) {
      throw new Error(`Line ${index + 1} is missing the exercise name.`);
    }

    if (!Number.isInteger(sets) || sets <= 0) {
      throw new Error(`Line ${index + 1} has an invalid sets value.`);
    }

    if (!Number.isInteger(reps) || reps <= 0) {
      throw new Error(`Line ${index + 1} has an invalid reps value.`);
    }

    if (!Number.isInteger(restSeconds) || restSeconds < 0) {
      throw new Error(`Line ${index + 1} has an invalid rest value.`);
    }

    return { name, sets, reps, restSeconds };
  });
}

function render() {
  if (!hasWorkoutLoaded()) {
    progressText.textContent = "No workout loaded";
    workoutCard.className = "workout-card empty";
    workoutCard.innerHTML = '<p class="empty-state">Load a workout to start moving through sets.</p>';
    previousSetButton.disabled = true;
    completeSetButton.disabled = true;
    skipRestButton.disabled = true;
    skipRestButton.textContent = "Skip Rest";
    return;
  }

  if (state.mode === "done") {
    progressText.textContent = `${state.exercises.length} exercises finished`;
    workoutCard.className = "workout-card";
    workoutCard.innerHTML = `
      <div class="status-pill resting">Workout complete</div>
      <h2 class="exercise-name">Done.</h2>
      <div class="up-next">You finished every set in this session.</div>
    `;
    previousSetButton.disabled = false;
    completeSetButton.disabled = true;
    skipRestButton.disabled = false;
    skipRestButton.textContent = "New Workout";
    return;
  }

  const exercise = state.exercises[state.exerciseIndex];
  const setNumber = state.setIndex + 1;
  const totalSets = exercise.sets;
  const totalExercises = state.exercises.length;
  const exerciseNumber = state.exerciseIndex + 1;
  const isResting = state.mode === "rest";
  const restRemaining = isResting ? getRestRemainingSeconds() : exercise.restSeconds;

  progressText.textContent = `Exercise ${exerciseNumber}/${totalExercises}`;
  workoutCard.className = "workout-card";
  workoutCard.innerHTML = `
    <div class="status-pill ${isResting ? "resting" : ""}">
      ${isResting ? "Resting" : "Lift"}
    </div>
    <h2 class="exercise-name">${escapeHtml(exercise.name)}</h2>
    <div class="metrics">
      <div class="metric">
        <p class="meta-label">Set</p>
        <p class="meta-value">${setNumber} / ${totalSets}</p>
      </div>
      <div class="metric">
        <p class="meta-label">Reps</p>
        <p class="meta-value">${exercise.reps}</p>
      </div>
      <div class="metric">
        <p class="meta-label">${isResting ? "Rest left" : "Rest after set"}</p>
        <p class="meta-value">${formatSeconds(restRemaining)}</p>
      </div>
    </div>
    <div class="up-next">${buildNextText()}</div>
  `;

  previousSetButton.disabled = isAtFirstSet();
  completeSetButton.disabled = isResting;
  skipRestButton.disabled = false;
  skipRestButton.textContent = isResting ? "Skip Rest" : "Skip Exercise Rest";
}

function buildNextText() {
  const exercise = state.exercises[state.exerciseIndex];
  const nextSetIndex = state.setIndex + 1;

  if (nextSetIndex < exercise.sets) {
    return `Up next: ${exercise.name}, set ${nextSetIndex + 1} of ${exercise.sets}.`;
  }

  if (state.exerciseIndex + 1 < state.exercises.length) {
    const nextExercise = state.exercises[state.exerciseIndex + 1];
    return `Up next: ${nextExercise.name}, set 1 of ${nextExercise.sets}.`;
  }

  return "Up next: workout complete.";
}

function syncTimer() {
  stopCountdown();

  if (state.mode !== "rest") {
    return;
  }

  const tick = () => {
    if (getRestRemainingSeconds() <= 0) {
      advanceAfterRest();
      return;
    }

    render();
  };

  tick();
  countdownInterval = window.setInterval(tick, 250);
}

function advanceAfterRest() {
  stopCountdown();

  const currentExercise = state.exercises[state.exerciseIndex];
  const hasAnotherSet = state.setIndex + 1 < currentExercise.sets;

  if (hasAnotherSet) {
    state.setIndex += 1;
  } else {
    state.exerciseIndex += 1;
    state.setIndex = 0;
  }

  state.mode = "active";
  state.restEndsAt = null;
  saveState();
  playAlert();
  render();
}

function goToPreviousSet() {
  stopCountdown();

  if (state.mode === "done") {
    const lastExercise = state.exercises[state.exercises.length - 1];
    state.exerciseIndex = state.exercises.length - 1;
    state.setIndex = lastExercise.sets - 1;
  } else if (state.mode === "rest") {
    // During rest, the visible set is the one just completed.
  } else if (state.setIndex > 0) {
    state.setIndex -= 1;
  } else if (state.exerciseIndex > 0) {
    state.exerciseIndex -= 1;
    state.setIndex = state.exercises[state.exerciseIndex].sets - 1;
  }

  state.mode = "active";
  state.restEndsAt = null;
  state.completedAt = null;
}

function getRestRemainingSeconds() {
  if (!state.restEndsAt) {
    return 0;
  }

  return Math.max(0, Math.ceil((state.restEndsAt - Date.now()) / 1000));
}

function formatSeconds(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function hasWorkoutLoaded() {
  return state.exercises.length > 0;
}

function isAtFirstSet() {
  return state.exerciseIndex === 0 && state.setIndex === 0 && state.mode !== "done";
}

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = type ? `message ${type}` : "message";
}

function loadStoredState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultState();
    }

    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function stopCountdown() {
  if (countdownInterval) {
    window.clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function focusRunner() {
  runnerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function playAlert() {
  if ("vibrate" in navigator) {
    navigator.vibrate([120, 60, 120]);
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.35);
    oscillator.onended = () => context.close();
  } catch {
    // Ignore audio failures; the app still advances state correctly.
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
