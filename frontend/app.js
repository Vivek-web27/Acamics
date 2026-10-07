import { supabase } from "./supabase-client.js";

// -----------------------------
// Supabase Authentication
// -----------------------------

let currentUser = null;
let currentUserRole = null;

function getCurrentUserId() {
  return currentUser?.id || null;
}

function updateAuthButton() {
  const button = document.getElementById("authBtn");
  const roleBadge = document.getElementById("userRoleBadge");
  if (roleBadge) {
    if (currentUser) {
      const role = currentUserRole || "unavailable";
      roleBadge.textContent = role === "unavailable"
        ? "Role unavailable"
        : role.charAt(0).toUpperCase() + role.slice(1);
      roleBadge.dataset.role = role;
      roleBadge.hidden = false;
    } else {
      roleBadge.textContent = "";
      roleBadge.hidden = true;
      delete roleBadge.dataset.role;
    }
  }

  if (!button) return;

  if (currentUser) {
    const roleLabel = currentUserRole || "Role unavailable";
    button.title = `Signed in as ${currentUser.email || "User"} (${roleLabel})`;
    button.dataset.signedIn = "true";
    button.setAttribute("aria-label", "Account");
  } else {
    button.title = "Sign in";
    button.dataset.signedIn = "false";
    button.setAttribute("aria-label", "Sign in");
  }
}

async function loadCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.error("Could not get current user:", error);
    currentUser = null;
  } else {
    currentUser = data.user;
  }

  if (currentUser) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (profileError) {
      console.error("Could not load user profile:", profileError);
      currentUserRole = null;
    } else {
      currentUserRole = profile?.role || "student";
    }
  } else {
    currentUserRole = null;
  }

  updateAuthButton();
}

async function handleAuthButton() {
  if (currentUser) {
    const shouldSignOut = confirm(
      `Signed in as ${currentUser.email || "your account"}.\n\nSign out?`
    );

    if (!shouldSignOut) return;

    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(`Could not sign out: ${error.message}`);
      return;
    }

    currentUser = null;
    currentUserRole = null;
    updateAuthButton();
    window.location.assign("index.html");
    return;
  }

  window.location.href = "index.html";
}

supabase.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;

  if (currentUser) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) {
      console.error("Could not load user role:", error);
      currentUserRole = null;
    } else {
      currentUserRole = profile?.role || "student";
    }
  } else {
    currentUserRole = null;
  }

  updateAuthButton();
});

/**
 * ACAMICS / CampusSync — Frontend Event Controller
 * Plain JavaScript, clean linear code, and no frameworks.
 */

// Permanent category -> poster mapping.
// Keep these keys exactly aligned with events.json / the event category taxonomy.
const CATEGORY_POSTERS = {
  "Academic": "posters/academic.png",
  "Exams": "posters/exams.png",
  "Reviews & Submissions": "posters/reviews-submissions.png",
  "Fests & Cultural": "posters/fests-cultural.png",
  "Breaks": "posters/breaks.png",
  "Technical": "posters/technical.png"
};

const PERSONAL_EVENTS_KEY = "acamics_personal_events";
const LEGACY_PERSONAL_EVENTS_KEY = "campussync_personal_events";

// Master list combines shared official events with the signed-in user's personal events.
let allEvents = [];
let editingEventId = null;
let eventFormScope = "personal";
let lifecycleActionMode = null;

// Coordinated Filter State
let activeFilters = {
  source: "ALL",
  category: "ALL",
  status: "ALL"
};

let selectedCalendarYear = new Date().getFullYear();
let selectedCohortStartYear = null;
let selectedAcademicPart = null;

let searchQuery = "";
let selectedEvent = null;
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  const installButton = document.getElementById("installAppBtn");
  if (installButton) installButton.hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  const installButton = document.getElementById("installAppBtn");
  if (installButton) installButton.hidden = true;
});

function setupInstallButton() {
  const button = document.getElementById("installAppBtn");
  if (!button) return;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (isStandalone) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  button.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      alert(/iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? "To install Acamics on iPhone: tap Share, then choose Add to Home Screen."
        : "Open your browser menu and choose Install Acamics or Add to Home Screen.");
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
}

function setReminderStatus(message, isError = false) {
  const status = document.getElementById("reminderStatus");
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? "#ff9b9b" : "";
}

function decodeApplicationServerKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

async function setupReminderControls() {
  const cohortSelect = document.getElementById("reminderCohortSelect");
  const enableButton = document.getElementById("enablePushBtn");
  const disableButton = document.getElementById("disablePushBtn");
  const testButton = document.getElementById("testPushBtn");
  if (!cohortSelect || !enableButton) return;

  cohortSelect.innerHTML = [2026, 2025, 2024, 2023].map(year =>
    `<option value="${year}">${year}–${year + 4} batch</option>`
  ).join("");
  cohortSelect.value = String(selectedCohortStartYear || 2025);
  cohortSelect.addEventListener("change", () => renderUpcomingReminderPreview(Number(cohortSelect.value)));
  document.getElementById("reminderOneDay").addEventListener("change", () => renderUpcomingReminderPreview(Number(cohortSelect.value)));
  document.getElementById("reminderOneHour").addEventListener("change", () => renderUpcomingReminderPreview(Number(cohortSelect.value)));

  if (!currentUser) {
    enableButton.disabled = true;
    setReminderStatus("Sign in to save reminders to your account.");
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    enableButton.disabled = true;
    setReminderStatus("Push reminders are not supported by this browser.", true);
    return;
  }

  try {
    const { data: preference, error } = await supabase.from("reminder_preferences")
      .select("enabled,cohort_start_year,offsets_minutes")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (error) throw error;
    if (preference) {
      cohortSelect.value = String(preference.cohort_start_year);
      document.getElementById("reminderOneDay").checked = preference.offsets_minutes.includes(1440);
      document.getElementById("reminderOneHour").checked = preference.offsets_minutes.includes(60);
    }
    const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    const enabled = Boolean(preference?.enabled && subscription);
    enableButton.textContent = enabled ? "Update reminders" : "Enable reminders";
    disableButton.hidden = !enabled;
    testButton.hidden = !enabled;
    document.getElementById("reminderEnabledDot").hidden = !enabled;
    setReminderStatus(enabled ? "Reminders are enabled on this device." : "Choose a batch and enable reminders.");
    renderUpcomingReminderPreview(Number(cohortSelect.value));
  } catch (error) {
    console.error("Could not load reminder preferences:", error);
    setReminderStatus("Apply the reminder database migration, then reload this page.", true);
  }

  enableButton.addEventListener("click", async () => {
    enableButton.disabled = true;
    setReminderStatus("Setting up this device…");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Allow notifications in your browser to enable reminders.");
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const { data, error } = await supabase.functions.invoke("send-reminders", { method: "GET" });
        if (error) throw error;
        if (!data?.publicKey) throw new Error("The push server has not published its public key yet.");
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationServerKey(data.publicKey),
        });
      }

      const subscriptionJson = subscription.toJSON();
      const keys = subscriptionJson.keys || {};
      if (!keys.p256dh || !keys.auth) throw new Error("The browser did not provide a complete push subscription.");
      const offsets = [];
      if (document.getElementById("reminderOneDay").checked) offsets.push(1440);
      if (document.getElementById("reminderOneHour").checked) offsets.push(60);
      if (!offsets.length) throw new Error("Select at least one reminder time.");

      const { error: subscriptionError } = await supabase.from("push_subscriptions").upsert({
        endpoint: subscription.endpoint,
        user_id: currentUser.id,
        p256dh: keys.p256dh,
        auth_secret: keys.auth,
        expiration_time: subscription.expirationTime ? new Date(subscription.expirationTime).toISOString() : null,
      });
      if (subscriptionError) throw subscriptionError;
      const { error: preferenceError } = await supabase.from("reminder_preferences").upsert({
        user_id: currentUser.id,
        enabled: true,
        cohort_start_year: Number(cohortSelect.value),
        offsets_minutes: offsets,
        timezone: "Asia/Kolkata",
      });
      if (preferenceError) throw preferenceError;
      enableButton.textContent = "Update reminders";
      disableButton.hidden = false;
      testButton.hidden = false;
      document.getElementById("reminderEnabledDot").hidden = false;
      renderUpcomingReminderPreview(Number(cohortSelect.value));
      setReminderStatus("Reminders are enabled on this device.");
    } catch (error) {
      console.error("Could not enable reminders:", error);
      let isBrave = false;
      try {
        isBrave = Boolean(navigator.brave && await navigator.brave.isBrave());
      } catch { /* Browser detection is optional; keep the original error below. */ }
      const message = error.message === "Failed to send a request to the Edge Function"
        ? "Could not reach Supabase. Redeploy send-reminders after the CORS fix, then try again."
        : isBrave && error.name === "AbortError"
          ? "Brave blocked its push service. In brave://settings/privacy, turn on ‘Use Google services for push messaging’, relaunch Brave, then try again."
          : error.message || "Could not enable reminders.";
      setReminderStatus(message, true);
    } finally {
      enableButton.disabled = false;
    }
  });

  disableButton.addEventListener("click", async () => {
    disableButton.disabled = true;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", currentUser.id);
        await subscription.unsubscribe();
      }
      const { error } = await supabase.from("reminder_preferences").upsert({
        user_id: currentUser.id,
        enabled: false,
        cohort_start_year: Number(cohortSelect.value),
        offsets_minutes: [1440, 60],
        timezone: "Asia/Kolkata",
      });
      if (error) throw error;
      enableButton.textContent = "Enable reminders";
      disableButton.hidden = true;
      testButton.hidden = true;
      document.getElementById("reminderEnabledDot").hidden = true;
      setReminderStatus("Reminders are turned off on this device.");
    } catch (error) {
      setReminderStatus(error.message || "Could not turn reminders off.", true);
    } finally {
      disableButton.disabled = false;
    }
  });

  testButton.addEventListener("click", async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("Acamics reminders are ready", {
        body: "This is a test alert from your Acamics app.",
        icon: "./icons/acamics-192.png",
        badge: "./icons/acamics-192.png",
        tag: "acamics-test-alert",
        data: { url: "./calendar.html" },
      });
      setReminderStatus("Test alert sent. Real event reminders need the Supabase scheduler enabled.");
    } catch (error) {
      setReminderStatus(error.message || "Could not show a test alert.", true);
    }
  });
}

function renderUpcomingReminderPreview(cohortStartYear) {
  const list = document.getElementById("upcomingRemindersList");
  const count = document.getElementById("upcomingRemindersCount");
  if (!list || !count) return;
  if (!currentUser) {
    list.innerHTML = '<p class="settings-desc">Sign in to see events for your batch.</p>';
    count.textContent = "0";
    return;
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const offsets = [];
  if (document.getElementById("reminderOneDay")?.checked) offsets.push("1 day before");
  if (document.getElementById("reminderOneHour")?.checked) offsets.push("1 hour before");
  const candidates = allEvents.filter(event => {
    if (!event.start_date || event.start_date < today || ["cancelled", "completed"].includes(String(event.lifecycle_status || "").toLowerCase())) return false;
    if (!event.isOfficial) return event.ownerId === currentUser.id;
    const targets = Array.isArray(event.target_cohort_start_years) ? event.target_cohort_start_years.map(Number) : [];
    return targets.length === 0 || targets.includes(cohortStartYear);
  }).sort((a, b) => a.start_date.localeCompare(b.start_date) || String(a.start_time || "").localeCompare(String(b.start_time || "")));

  count.textContent = String(candidates.length);
  if (!candidates.length) {
    list.innerHTML = '<p class="settings-desc">No upcoming events match this batch yet.</p>';
    return;
  }
  list.innerHTML = candidates.slice(0, 8).map(event => {
    const eventOffsets = event.start_time ? offsets : offsets.includes("1 day before") ? ["1 day before"] : [];
    const tags = eventOffsets.length
      ? eventOffsets.map(label => `<span class="reminder-time-chip">${label}</span>`).join("")
      : '<span class="reminder-time-chip reminder-time-chip-muted">No reminder time selected</span>';
    return `<article class="upcoming-reminder-item"><div class="upcoming-reminder-copy"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(formatReadableDate(event.start_date))}${event.start_time ? ` · ${escapeHtml(event.start_time.slice(0, 5))}` : " · Time not set"}</span></div><div class="upcoming-reminder-times">${tags}</div></article>`;
  }).join("");
}

// ==========================================
// 1. SIMPLE DYNAMIC STATUS CALCULATOR
// ==========================================
function getDisplayStatus(ev) {
  if (ev?.lifecycle_status === "cancelled") return "Cancelled";
  if (ev?.lifecycle_status === "postponed") {
    return "Postponed";
  }

  if (ev?.lifecycle_status === "completed") {
    return "Completed";
  }

  const dateStatus = getEventStatus(ev?.start_date, ev?.end_date);
  // Official events are completed only after staff records confirmation and proof.
  if (ev?.isOfficial && dateStatus === "Completed") return "Awaiting confirmation";
  if (ev?.lifecycle_status === "ongoing") return "Ongoing";
  return dateStatus;
}

function localTodayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function canConfirmEventCompletion(ev) {
  const endDate = ev?.end_date || ev?.start_date;
  return Boolean(
    ev?.isOfficial &&
    isStaffUser() &&
    ev?.lifecycle_status !== "cancelled" &&
    ev?.lifecycle_status !== "completed" &&
    endDate &&
    endDate <= localTodayString()
  );
}

function canCancelOfficialEvent(ev) {
  return Boolean(
    ev?.isOfficial &&
    isStaffUser() &&
    ev?.lifecycle_status !== "cancelled" &&
    ev?.lifecycle_status !== "completed"
  );
}

function getEventStatus(startDateStr, endDateStr) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  const end = endDateStr || startDateStr;

  if (todayStr < startDateStr) {
    return "Upcoming";
  } else if (todayStr >= startDateStr && todayStr <= end) {
    return "Ongoing";
  } else {
    return "Completed";
  }
}

// ==========================================
// 2. READABLE DATE FORMATTERS
// ==========================================
function formatReadableDate(dateStr) {
  if (!dateStr) return "Not specified";

  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);

  return dt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatBadgeDate(startStr, endStr) {
  const months = [
    "JAN","FEB","MAR","APR","MAY","JUN",
    "JUL","AUG","SEP","OCT","NOV","DEC"
  ];

  const formatSingle = (s) => {
    const parts = s.split("-");
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${parts[2]} ${months[mIdx]}`;
  };

  if (!endStr || endStr === startStr) {
    return formatSingle(startStr);
  }

  return `${formatSingle(startStr)} ➔ ${formatSingle(endStr)}`;
}

// ==========================================
// 3. EXAM ENCOURAGEMENT HELPER
// ==========================================
function getExamEncouragement(startDateStr) {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const today = `${year}-${month}-${day}`;

  if (today > startDateStr) return null;

  if (today === startDateStr) {
    return "🎯 <strong>Exam Day!</strong> Stay calm, read carefully, and do your best!";
  }

  const [sY, sM, sD] = startDateStr.split("-").map(Number);

  const target = new Date(sY, sM - 1, sD);
  const current = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const diffDays = Math.round(
    (target.getTime() - current.getTime()) /
    (1000 * 60 * 60 * 24)
  );

  if (diffDays === 1) {
    return "🔥 <strong>Your exam is tomorrow!</strong> One final revision. You've got this!";
  }

  return "🍀 <strong>Best of luck!</strong> Prepare well and give it your best.";
}

// ==========================================
// 4. AUTOMATIC CATEGORY DETECTION
// ==========================================
function detectCategory(title, description = "") {
  const text = `${title} ${description}`.toLowerCase();

  if (
    text.includes("exam") ||
    text.includes("mid-sem") ||
    text.includes("in-sem") ||
    text.includes("ese") ||
    text.includes("viva") ||
    text.includes("oral") ||
    text.includes("test")
  ) {
    return "Exams";
  }

  if (
    text.includes("review") ||
    text.includes("submission") ||
    text.includes("dissertation") ||
    text.includes("termwork") ||
    text.includes("assignment")
  ) {
    return "Reviews & Submissions";
  }

  if (
    text.includes("dance") ||
    text.includes("music") ||
    text.includes("cultural") ||
    text.includes("fest") ||
    text.includes("gathering") ||
    text.includes("celebration")
  ) {
    return "Fests & Cultural";
  }

  if (
    text.includes("break") ||
    text.includes("holiday") ||
    text.includes("vacation") ||
    text.includes("diwali")
  ) {
    return "Breaks";
  }

  if (
    text.includes("coding") ||
    text.includes("programming") ||
    text.includes("hackathon") ||
    text.includes("robotics") ||
    text.includes("technical") ||
    text.includes("technology") ||
    text.includes("tech")
  ) {
    return "Technical";
  }

  return "Academic";
}

// ==========================================
// 5. SUPABASE PERSONAL EVENTS
// ==========================================
async function migrateLegacyPersonalEvents() {
  if (!currentUser) return;

  const migrationKey = `acamics_personal_events_migrated_${currentUser.id}`;
  if (localStorage.getItem(migrationKey) === "done") return;

  const sourceKey = localStorage.getItem(PERSONAL_EVENTS_KEY) !== null
    ? PERSONAL_EVENTS_KEY
    : LEGACY_PERSONAL_EVENTS_KEY;
  const raw = localStorage.getItem(sourceKey);
  if (!raw) {
    localStorage.setItem(migrationKey, "done");
    return;
  }

  let legacyEvents;
  try {
    legacyEvents = JSON.parse(raw);
  } catch (error) {
    console.error("Could not parse saved personal events for migration:", error);
    return;
  }
  if (!Array.isArray(legacyEvents)) return;

  const ownedEvents = legacyEvents.filter(event =>
    event && (event.ownerId === currentUser.id || event.ownerId === "student-1")
  );
  if (ownedEvents.length === 0) {
    localStorage.setItem(migrationKey, "done");
    return;
  }

  const rows = ownedEvents.map(event => ({
    owner_id: currentUser.id,
    legacy_id: String(event.id ?? crypto.randomUUID()),
    title: String(event.title || "Untitled Event").trim(),
    category: String(event.category || "Academic"),
    start_date: event.start_date || event.date,
    end_date: event.end_date || event.start_date || event.date,
    start_time: event.start_time || null,
    end_time: event.end_time || null,
    location: event.location || event.venue || "Campus",
    description: event.description || "",
    color_theme: event.color_theme || null
  }));

  const { error } = await supabase
    .from("personal_events")
    .upsert(rows, { onConflict: "owner_id,legacy_id", ignoreDuplicates: true });
  if (error) throw error;

  const migratedIds = new Set(ownedEvents.map(event => String(event.id)));
  const remaining = legacyEvents.filter(event => !migratedIds.has(String(event?.id)));
  localStorage.setItem(sourceKey, JSON.stringify(remaining));
  localStorage.setItem(migrationKey, "done");
}

async function loadPersonalEvents() {
  if (!currentUser) return [];

  await migrateLegacyPersonalEvents();
  const { data, error } = await supabase
    .from("personal_events")
    .select("*")
    .eq("owner_id", currentUser.id)
    .order("start_date", { ascending: true });

  if (error) throw error;
  return (data || []).map(event => ({
    ...event,
    isOfficial: false,
    source: "personal",
    ownerId: event.owner_id,
    status: getEventStatus(event.start_date, event.end_date)
  }));
}

// ==========================================
// 6. INITIALIZATION & DATA COMBINATION
// ==========================================
async function initApp() {
  try {
    const { data: officialEvents, error: eventsError } = await supabase
      .from("events")
      .select("*")
      .order("start_date", { ascending: true })
      .order("id", { ascending: true });

    if (eventsError) {
      throw eventsError;
    }

    const officialTagged = officialEvents.map(e => ({
      ...e,
      isOfficial: true,
      source: "official",
      ownerId: null,
      status: getDisplayStatus(e)
    }));

    let personalEvents = [];
    if (currentUser) {
      try {
        personalEvents = await loadPersonalEvents();
      } catch (personalError) {
        console.error("Could not load Supabase personal events:", personalError);
      }
    }

    allEvents = [...officialTagged, ...personalEvents];

    renderCalendarHierarchy();
    renderCards();
    updateNextEventBanner();
  } catch (err) {
    console.error("Initialization error:", err);
  }
}

function getCalendarYear(ev) {
  const explicitYear = Number(ev?.calendar_year);
  if (Number.isInteger(explicitYear) && explicitYear >= 1900) return explicitYear;
  const fromDate = Number(String(ev?.start_date || "").slice(0, 4));
  return Number.isInteger(fromDate) ? fromDate : null;
}

function getCohortLabel(calendarYear, cohortStartYear) {
  const yearNumber = calendarYear - cohortStartYear + 1;
  const suffix = yearNumber % 100 >= 11 && yearNumber % 100 <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[yearNumber % 10] || "th");
  return `${yearNumber}${suffix} year (${cohortStartYear}–${cohortStartYear + 4})`;
}

function renderCalendarHierarchy() {
  const container = document.getElementById("calendarYearGroups");
  if (!container) return;

  const years = [...new Set(allEvents
    .filter(event => event.isOfficial)
    .map(getCalendarYear)
    .filter(year => Number.isInteger(year)))].sort((a, b) => a - b);
  if (!years.length) years.push(new Date().getFullYear());
  if (!years.includes(selectedCalendarYear)) {
    selectedCalendarYear = years.includes(new Date().getFullYear())
      ? new Date().getFullYear()
      : years[years.length - 1];
  }

  const calendarTitle = document.getElementById("calendarTitle");
  if (calendarTitle) {
    calendarTitle.textContent = selectedCohortStartYear === null
      ? `The calendar · ${selectedCalendarYear} · choose a batch`
      : `${getCohortLabel(selectedCalendarYear, selectedCohortStartYear)}${selectedAcademicPart === null ? " · choose a part" : ` · Part ${selectedAcademicPart}`}`;
  }

  container.innerHTML = years.map(year => {
    const isSelectedYear = year === selectedCalendarYear;
    const cohorts = [0, 1, 2, 3].map(offset => year - offset);
    const batchControls = `<div class="cohort-batch-list" aria-label="${year} undergraduate cohorts">
          ${cohorts.map(cohort => `<button type="button" class="filter-pill calendar-cohort-btn ${selectedCohortStartYear === cohort && isSelectedYear ? "active" : ""}" data-calendar-year="${year}" data-cohort="${cohort}">${escapeHtml(getCohortLabel(year, cohort))}</button>`).join("")}
        </div>
        ${selectedCohortStartYear !== null && selectedCalendarYear === year
          ? `<div class="calendar-part-picker" aria-label="Academic calendar part">
              <span class="calendar-part-label">${escapeHtml(getCohortLabel(year, selectedCohortStartYear))} calendar</span>
              <div class="calendar-part-buttons">
                <button type="button" class="filter-pill calendar-part-btn ${selectedAcademicPart === 1 ? "active" : ""}" data-part="1">Part 1</button>
                <button type="button" class="filter-pill calendar-part-btn ${selectedAcademicPart === 2 ? "active" : ""}" data-part="2">Part 2</button>
              </div>
            </div>`
          : ""}`;
    return `<details class="calendar-year-group" data-year="${year}" ${isSelectedYear ? "open" : ""}>
      <summary><span>${year}</span><span class="calendar-year-caption">${year} calendar</span></summary>
      ${batchControls}
    </details>`;
  }).join("");

  container.querySelectorAll(".calendar-year-group").forEach(group => {
    group.addEventListener("toggle", () => {
      if (!group.open) return;
      container.querySelectorAll(".calendar-year-group").forEach(other => {
        if (other !== group) other.open = false;
      });
    });
  });
  container.querySelectorAll(".calendar-cohort-btn").forEach(button => {
    button.addEventListener("click", () => {
      selectedCalendarYear = Number(button.dataset.calendarYear);
      selectedCohortStartYear = Number(button.dataset.cohort);
      selectedAcademicPart = null;
      renderCalendarHierarchy();
      renderCards();
      updateNextEventBanner();
    });
  });
  container.querySelectorAll(".calendar-part-btn").forEach(button => {
    button.addEventListener("click", () => {
      selectedAcademicPart = Number(button.dataset.part);
      renderCalendarHierarchy();
      renderCards();
      updateNextEventBanner();
    });
  });
}

// ==========================================
// 7. FILTER & RENDER ENGINE
// ==========================================
function getFilteredEvents() {
  const q = searchQuery.toLowerCase().trim();

  return allEvents
    .filter(ev => {

      // A. Source filter
      if (
        activeFilters.source === "OFFICIAL" &&
        !ev.isOfficial
      ) {
        return false;
      }

      if (
        activeFilters.source === "PERSONAL" &&
        (
          ev.isOfficial ||
          ev.ownerId !== getCurrentUserId()
        )
      ) {
        return false;
      }

      // B. Calendar year is taken from start_date so a January event appears
      // under January's calendar year, even when its academic_year is 2026-27.
      if (getCalendarYear(ev) !== selectedCalendarYear) return false;
      if (selectedCohortStartYear === null || selectedAcademicPart === null) return false;

      // Personal events belong to the signed-in user and are not cohort-scoped.
      // Official events use cohort and academic-part values managed in Supabase.
      if (ev.isOfficial) {
        // Until the cohort migration is applied, older rows without this
        // field are treated as part of the calendar's 2025-2029 cohort.
        const cohortTargets = Array.isArray(ev.target_cohort_start_years)
          ? ev.target_cohort_start_years.map(Number)
          : [2025];
        if (cohortTargets.length > 0 && !cohortTargets.includes(selectedCohortStartYear)) return false;
        if (Number(ev.academic_part ?? 1) !== selectedAcademicPart) return false;
      } else if (selectedAcademicPart === 2 && activeFilters.source !== "PERSONAL") {
        // Part 2 has no official calendar data yet. Keep this view empty until
        // its calendar is imported; personal events remain available by choice.
        return false;
      }

      // C. Category filter
      if (
        activeFilters.category !== "ALL" &&
        ev.category.toLowerCase() !==
        activeFilters.category.toLowerCase()
      ) {
        return false;
      }

      // D. Dynamic status filter
      const status = getDisplayStatus(ev);

      if (
        activeFilters.status !== "ALL" &&
        status.toUpperCase() !==
        activeFilters.status.toUpperCase()
      ) {
        return false;
      }

      // E. Search filter
      if (q) {
        const matchTitle =
          (ev.title || "").toLowerCase().includes(q);

        const matchDesc =
          (ev.description || "").toLowerCase().includes(q);

        const matchLoc =
          (ev.location || "").toLowerCase().includes(q);

        const matchCat =
          (ev.category || "").toLowerCase().includes(q);

        if (
          !matchTitle &&
          !matchDesc &&
          !matchLoc &&
          !matchCat
        ) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) =>
      a.start_date.localeCompare(b.start_date)
    );
}

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char])
  );
}

function renderCards() {
  const grid = document.getElementById("eventsGrid");

  if (!grid) return;

  grid.innerHTML = "";

  const filtered = getFilteredEvents();

  if (selectedCohortStartYear === null) {
    grid.innerHTML = `<div class="empty-state">Choose a batch above to see its academic calendar.</div>`;
    return;
  }

  if (selectedAcademicPart === null) {
    grid.innerHTML = `<div class="empty-state">Choose Part 1 or Part 2 above for ${escapeHtml(getCohortLabel(selectedCalendarYear, selectedCohortStartYear))}.</div>`;
    return;
  }

  if (selectedAcademicPart === 2 && activeFilters.source !== "PERSONAL") {
    grid.innerHTML = `<div class="empty-state">The Part 2 academic calendar for ${escapeHtml(getCohortLabel(selectedCalendarYear, selectedCohortStartYear))} has not been added yet.</div>`;
    return;
  }

  if (filtered.length === 0) {
    grid.innerHTML =
      `<div class="empty-state">No events found matching your criteria.</div>`;
    return;
  }

  filtered.forEach(ev => {
    const card = document.createElement("div");

    card.className = "card";

    const status = getDisplayStatus(ev);

    const dateBadgeText =
      formatBadgeDate(
        ev.start_date,
        ev.end_date
      );

    const posterPath = ev.poster
      ? `posters/${ev.poster}`
      : CATEGORY_POSTERS[ev.category] || null;

    const fallbackBackground =
      ev.color_theme ||
      "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)";

    card.innerHTML = `
      <div class="card-poster" style="background: ${fallbackBackground};">

        ${posterPath ? `
          <img
            class="category-poster-image"
            src="${posterPath}"
            alt=""
            aria-hidden="true"
            loading="lazy"
          >
        ` : ""}

        <div class="poster-overlay"></div>

        <div class="date-badge-box">
          ${escapeHtml(dateBadgeText)}
        </div>

        <div class="source-badge ${ev.isOfficial ? 'badge-official' : 'badge-personal'}">
          ${
            ev.isOfficial
              ? 'OFFICIAL'
              : ev.approvalStatus === 'pending'
                ? 'PENDING'
                : 'MY EVENT'
          }
        </div>

        <div class="status-badge status-${status.toLowerCase().replace(/\s+/g, "-")}">
          ${status}
        </div>

        ${canConfirmEventCompletion(ev) ? `
          <button class="card-completion-action" type="button" aria-label="Confirm ${escapeHtml(ev.title)} is complete">
            Confirm completed?
          </button>
        ` : ""}

      </div>

      <div class="card-info">

        <h4 class="card-title">
          ${escapeHtml(ev.title)}
        </h4>

        <p class="card-subtitle">
          ${escapeHtml(ev.category)}
          •
          ${escapeHtml(ev.location || "To be announced")}
        </p>

        <p class="card-desc">
          ${escapeHtml(
            ev.description ||
            "No description provided."
          )}
        </p>

        <div class="card-cta">
          View Details ➔
        </div>

      </div>
    `;

    const posterImage =
      card.querySelector(
        ".category-poster-image"
      );

    if (posterImage) {
      posterImage.addEventListener(
        "error",
        () => {
          posterImage.remove();
        }
      );
    }

    card.querySelector(".card-completion-action")?.addEventListener("click", event => {
      event.stopPropagation();
      openEventDetails(ev).then(() => openLifecycleAction("complete"));
    });

    card.addEventListener("click", () => openEventDetails(ev));

    grid.appendChild(card);
  });
}

function updateNextEventBanner() {
  const banner =
    document.getElementById("nextEventBanner");

  const now =
    new Date().toISOString().split("T")[0];

  const upcoming = getFilteredEvents()
    .filter(
      e =>
        e.start_date >= now &&
        getDisplayStatus(e) !== "Completed" &&
        getDisplayStatus(e) !== "Postponed" &&
        getDisplayStatus(e) !== "Cancelled"
    )
    .sort((a, b) =>
      a.start_date.localeCompare(
        b.start_date
      )
    );

  if (upcoming.length > 0) {

    const nextEv = upcoming[0];

    banner.style.display = "flex";

    document.getElementById(
      "bannerTitle"
    ).textContent = nextEv.title;

    document.getElementById(
      "bannerMeta"
    ).textContent =
      `${formatReadableDate(nextEv.start_date)} • ${nextEv.location || "To be announced"}`;

    document.getElementById(
      "bannerActionBtn"
    ).onclick =
      () => openEventDetails(nextEv);

  } else {

    banner.style.display = "none";

  }
}

// ==========================================
// EVENT MUTATIONS
// ==========================================
function isStaffUser() {
  return currentUserRole === "admin" || currentUserRole === "teacher";
}

function requestTeacherActionPassword() {
  if (currentUserRole === "admin") return Promise.resolve("");
  if (currentUserRole !== "teacher") {
    alert("Only admins and teachers can manage official events.");
    return Promise.resolve(null);
  }

  const backdrop = document.getElementById("staffActionPasswordBackdrop");
  const form = document.getElementById("staffActionPasswordForm");
  const input = document.getElementById("staffActionPasswordInput");
  const cancelButton = document.getElementById("cancelStaffActionPasswordBtn");
  const closeButton = document.getElementById("closeStaffActionPasswordBtn");
  input.value = "";
  backdrop.classList.add("active");

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      backdrop.classList.remove("active");
      form.removeEventListener("submit", onSubmit);
      cancelButton.removeEventListener("click", onCancel);
      closeButton.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onBackdropClick);
      input.value = "";
      resolve(value);
    };
    const onSubmit = event => {
      event.preventDefault();
      const password = input.value;
      finish(password ? password : null);
    };
    const onCancel = () => finish(null);
    const onBackdropClick = event => {
      if (event.target === backdrop) finish(null);
    };

    form.addEventListener("submit", onSubmit);
    cancelButton.addEventListener("click", onCancel);
    closeButton.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onBackdropClick);
    input.focus();
  });
}

async function callStaffAction(action, details = {}) {
  if (!currentUser || !isStaffUser()) {
    throw new Error("Only signed-in admins and teachers can manage official events.");
  }

  const actionPassword = Object.hasOwn(details, "actionPassword")
    ? details.actionPassword
    : currentUserRole === "teacher"
      ? await requestTeacherActionPassword()
      : "";
  if (actionPassword === null) return null;

  const { data, error } = await supabase.functions.invoke("staff-event-action", {
    body: { action, actionPassword, ...details }
  });

  if (error) {
    let message = error.message || "The staff action failed.";
    try {
      const response = await error.context.json();
      message = response.error || message;
    } catch {
      // Keep the SDK error message when the response is not JSON.
    }
    throw new Error(message);
  }
  return data;
}

function validDateRange(startDate, endDate) {
  const isValid = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  };
  return isValid(startDate) && isValid(endDate) && endDate >= startDate;
}

async function postponeSelectedEvent() {
  if (!selectedEvent || !currentUser) {
    alert("Please sign in first.");
    return;
  }

  if (!selectedEvent.isOfficial) {
    if (selectedEvent.ownerId !== currentUser.id) return;

    const newStartDate = prompt(
      "Enter the new start date (YYYY-MM-DD):",
      selectedEvent.start_date
    );
    if (newStartDate === null) return;
    const newEndDate = prompt(
      "Enter the new end date (YYYY-MM-DD):",
      selectedEvent.end_date || newStartDate
    );
    if (newEndDate === null) return;
    if (!validDateRange(newStartDate, newEndDate)) {
      alert("Enter valid dates; the end date cannot be before the start date.");
      return;
    }

    const { error } = await supabase
      .from("personal_events")
      .update({ start_date: newStartDate, end_date: newEndDate })
      .eq("id", selectedEvent.id)
      .eq("owner_id", currentUser.id);
    if (error) {
      console.error("Personal event reschedule failed:", error);
      alert(`Could not reschedule your event:\n\n${error.message}`);
      return;
    }

    alert("Personal event rescheduled.");
  } else {
    if (!isStaffUser()) {
      alert("Only admins and teachers can postpone official events.");
      return;
    }

    openLifecycleAction("postpone");
    return;
  }

  closeEventDetails();
  await initApp();
}

const EVENT_PROOF_BUCKET = "acamics-event-proof";
const MAX_EVENT_PROOF_SIZE = 10 * 1024 * 1024;

function openLifecycleAction(mode) {
  if (!selectedEvent || !currentUser) return;
  if (mode === "postpone" && (!selectedEvent.isOfficial || !isStaffUser() || !canCancelOfficialEvent(selectedEvent))) return;
  if (mode === "cancel" && !canCancelOfficialEvent(selectedEvent)) return;
  if (mode === "complete" && !canConfirmEventCompletion(selectedEvent)) return;

  lifecycleActionMode = mode;
  const isCompletion = mode === "complete";
  const isCancellation = mode === "cancel";
  const backdrop = document.getElementById("lifecycleActionBackdrop");
  const form = document.getElementById("lifecycleActionForm");
  const fileInput = document.getElementById("lifecycleAttachmentInput");
  document.getElementById("lifecycleActionTitle").textContent = isCompletion
    ? "Confirm event completion"
    : isCancellation
      ? "Cancel official event"
      : "Postpone official event";
  document.getElementById("lifecycleActionHelp").textContent = isCompletion
    ? "Add a short completion note and attach proof. A file is required before this event can be marked completed."
    : isCancellation
      ? "This keeps the event in the calendar with a Cancelled status. Add a reason so everyone can see why it was cancelled."
      : "Tell everyone why the event is changing dates. Adding a supporting file is optional.";
  document.getElementById("lifecycleDateFields").hidden = isCompletion || isCancellation;
  document.getElementById("lifecycleReasonLabel").textContent = isCompletion
    ? "Completion note *"
    : isCancellation
      ? "Cancellation reason *"
      : "Postponement reason *";
  document.getElementById("lifecycleFilePickerRow").hidden = isCancellation;
  document.getElementById("lifecycleAttachmentHint").hidden = isCancellation;
  document.getElementById("lifecycleAttachmentButtonText").textContent = isCompletion
    ? "Attach proof (required)"
    : "Add attachment (optional)";
  document.getElementById("lifecycleAttachmentHint").textContent = isCompletion
    ? "Required. A photo, timetable, PDF, or other proof is accepted, up to 10 MB."
    : "Optional. Attach a note or related document, up to 10 MB.";
  document.getElementById("submitLifecycleActionBtn").textContent = isCompletion
    ? "Mark completed"
    : isCancellation
      ? "Cancel event"
      : "Save postponement";
  document.getElementById("lifecycleNewStartDate").value = selectedEvent.start_date || "";
  document.getElementById("lifecycleNewEndDate").value = selectedEvent.end_date || selectedEvent.start_date || "";
  document.getElementById("lifecycleReasonInput").value = "";
  document.getElementById("lifecycleActionMessage").hidden = true;
  fileInput.value = "";
  // Keep validation in the submit handler so mobile browsers can focus the hidden picker.
  fileInput.required = false;
  fileInput.accept = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt";
  document.getElementById("lifecycleFilePickerRow").hidden = isCancellation;
  document.getElementById("lifecycleAttachmentName").textContent = "No file selected";
  form.querySelector("#submitLifecycleActionBtn").disabled = false;
  backdrop.classList.add("active");
}

function closeLifecycleAction() {
  document.getElementById("lifecycleActionBackdrop")?.classList.remove("active");
  lifecycleActionMode = null;
}

function showLifecycleActionMessage(message) {
  const node = document.getElementById("lifecycleActionMessage");
  node.textContent = message;
  node.hidden = false;
}

async function uploadEventProof(file) {
  if (!file) return null;
  if (file.size > MAX_EVENT_PROOF_SIZE) {
    throw new Error("The attachment must be 10 MB or smaller.");
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "proof";
  const path = `${currentUser.id}/${selectedEvent.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(EVENT_PROOF_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream"
  });
  if (error) throw new Error(`Could not upload attachment: ${error.message}`);
  return path;
}

async function submitLifecycleAction(event) {
  event.preventDefault();
  if (!selectedEvent || !lifecycleActionMode) return;

  const mode = lifecycleActionMode;
  const isCompletion = mode === "complete";
  const isCancellation = mode === "cancel";
  const reason = document.getElementById("lifecycleReasonInput").value.trim();
  const file = document.getElementById("lifecycleAttachmentInput").files?.[0] || null;
  const startDate = document.getElementById("lifecycleNewStartDate").value;
  const endDate = document.getElementById("lifecycleNewEndDate").value;
  if (!reason) return showLifecycleActionMessage(isCompletion
    ? "A completion note is required."
    : isCancellation
      ? "A cancellation reason is required."
      : "A postponement reason is required.");
  if (isCompletion && !file) return showLifecycleActionMessage("Attach a proof file before confirming completion.");
  if (!isCompletion && !isCancellation && !validDateRange(startDate, endDate)) {
    return showLifecycleActionMessage("Enter valid dates; the end date cannot be before the start date.");
  }
  if (file && file.size > MAX_EVENT_PROOF_SIZE) {
    return showLifecycleActionMessage("The attachment must be 10 MB or smaller.");
  }

  const submitButton = document.getElementById("submitLifecycleActionBtn");
  submitButton.disabled = true;
  submitButton.textContent = "Saving…";
  let attachmentPath = null;
  try {
    const actionPassword = currentUserRole === "teacher"
      ? await requestTeacherActionPassword()
      : "";
    if (actionPassword === null) return;
    attachmentPath = await uploadEventProof(file);
    const action = isCompletion ? "complete_official" : isCancellation ? "cancel_official" : "postpone_official";
    const details = {
      eventId: Number(selectedEvent.id),
      reason,
      attachmentPath,
      actionPassword
    };
    if (!isCompletion && !isCancellation) {
      details.newStartDate = startDate;
      details.newEndDate = endDate;
    }
    const result = await callStaffAction(action, details);
    if (!result) return;

    closeLifecycleAction();
    closeEventDetails();
    await initApp();
  } catch (error) {
    console.error("Event lifecycle update failed:", error);
    showLifecycleActionMessage(error.message || "Could not save this event update.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = isCompletion ? "Mark completed" : isCancellation ? "Cancel event" : "Save postponement";
  }
}

async function renderEventLifecycleHistory(ev) {
  const section = document.getElementById("modalLifecycleHistory");
  if (!section) return;
  const records = [
    ...(Array.isArray(ev.postponement_history) ? ev.postponement_history.map(item => ({ ...item, kind: "Postponed" })) : []),
    ...(Array.isArray(ev.completion_history) ? ev.completion_history.map(item => ({ ...item, kind: "Completion confirmed" })) : []),
    ...(Array.isArray(ev.cancellation_history) ? ev.cancellation_history.map(item => ({ ...item, kind: "Cancelled" })) : [])
  ].sort((a, b) => String(a.postponed_at || a.completed_at || a.cancelled_at || "").localeCompare(String(b.postponed_at || b.completed_at || b.cancelled_at || "")));

  if (records.length === 0) {
    section.hidden = true;
    section.innerHTML = "";
    return;
  }

  const entries = await Promise.all(records.map(async record => {
    const path = record.attachment_path;
    let attachmentLink = "";
    if (path) {
      try {
        const { data, error } = await supabase.storage.from(EVENT_PROOF_BUCKET).createSignedUrl(path, 60 * 60);
        if (!error && data?.signedUrl) {
          attachmentLink = `<a class="event-proof-link" href="${escapeHtml(data.signedUrl)}" target="_blank" rel="noopener">View attachment</a>`;
        }
      } catch (error) {
        console.warn("Could not create a signed event-proof link:", error);
      }
    }
    const date = record.postponed_at || record.completed_at || record.cancelled_at;
    const dateText = date ? new Date(date).toLocaleString() : "Date unavailable";
    const reasonLabel = record.kind === "Postponed" ? "Postponement reason" : record.kind === "Cancelled" ? "Cancellation reason" : "Completion note";
    const dateChange = record.kind === "Postponed" && record.new_start_date
      ? `<p class="event-history-dates">New dates: ${escapeHtml(record.new_start_date)} – ${escapeHtml(record.new_end_date || record.new_start_date)}</p>`
      : "";
    return `<article class="event-history-entry"><div class="event-history-heading"><strong>${record.kind}</strong><time>${escapeHtml(dateText)}</time></div><p><span>${reasonLabel}:</span> ${escapeHtml(record.reason || "Not provided")}</p>${dateChange}${attachmentLink}</article>`;
  }));
  section.innerHTML = `<h4>Event history</h4>${entries.join("")}`;
  section.hidden = false;
}

async function deleteSelectedOfficialEvent() {
  if (!selectedEvent?.isOfficial || !isStaffUser()) return;
  if (!confirm(`Delete official event \"${selectedEvent.title}\"? This removes it for everyone.`)) return;

  try {
    const result = await callStaffAction("delete_official", {
      eventId: Number(selectedEvent.id)
    });
    if (!result) return;
    closeEventDetails();
    await initApp();
  } catch (error) {
    console.error("Official event deletion failed:", error);
    alert(`Could not delete event:\n\n${error.message}`);
  }
}

// ==========================================
// 8. EVENT DETAILS & EXPORT
// ==========================================
async function openEventDetails(ev) {
  selectedEvent = ev;

  const modal =
    document.getElementById(
      "eventModalBackdrop"
    );

  document.getElementById(
    "modalTitle"
  ).textContent = ev.title;

  document.getElementById(
    "modalDates"
  ).textContent =
    ev.start_date === ev.end_date
      ? formatReadableDate(ev.start_date)
      : `${formatReadableDate(ev.start_date)} ➔ ${formatReadableDate(ev.end_date)}`;

  document.getElementById(
    "modalTime"
  ).textContent =
    ev.start_time
      ? `${ev.start_time} - ${ev.end_time || ''}`
      : "Not specified";

  document.getElementById(
    "modalLocation"
  ).textContent =
    ev.location || "To be announced";

  document.getElementById(
    "modalCategory"
  ).textContent =
    ev.category;

  document.getElementById(
    "modalDescription"
  ).textContent =
    ev.description || "Not specified";

  document.getElementById(
    "modalSource"
  ).textContent =
    ev.officialSource ||
    (
      ev.isOfficial
        ? "Official Academic Calendar"
        : "Personal Student Entry"
    );

  const examBox =
    document.getElementById(
      "modalExamNotice"
    );

  const encouragement =
    ev.category === "Exams"
      ? getExamEncouragement(
          ev.start_date
        )
      : null;

  if (
    encouragement &&
    getEventStatus(
      ev.start_date,
      ev.end_date
    ) !== "Completed"
  ) {
    examBox.style.display = "block";
    examBox.innerHTML = encouragement;
  } else {
    examBox.style.display = "none";
  }

  const personalActions =
    document.getElementById(
      "modalPersonalActions"
    );

  if (
    !ev.isOfficial &&
    ev.ownerId === getCurrentUserId()
  ) {
    personalActions.style.display =
      "inline-flex";
  } else {
    personalActions.style.display =
      "none";
  }

  document
    .getElementById("reminderToast")
    ?.style.setProperty(
      "display",
      "none"
    );
  // Refresh the role before deciding whether the static HTML button is visible.
  const postponeBtn = document.getElementById("postponeEventBtn");
  const completeBtn = document.getElementById("markCompletedBtn");
  const cancelBtn = document.getElementById("cancelOfficialEventBtn");

  if (currentUser) {
    const { data: profile, error: roleError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (roleError) {
      console.error("Could not load role for postponement:", roleError);
      currentUserRole = null;
    } else {
      currentUserRole = profile?.role || "student";
    }
  } else {
    currentUserRole = null;
  }

  const canManageOfficial = Boolean(ev.isOfficial && isStaffUser());
  const canReschedulePersonal = Boolean(
    !ev.isOfficial && currentUser && ev.ownerId === currentUser.id
  );
  const officialActions = document.getElementById("modalOfficialActions");

  if (postponeBtn) {
    postponeBtn.hidden = !(canReschedulePersonal || (canManageOfficial && canCancelOfficialEvent(ev)));
    postponeBtn.textContent = ev.isOfficial ? "Postpone Event" : "Reschedule Event";
  }
  if (completeBtn) completeBtn.hidden = !canConfirmEventCompletion(ev);
  if (officialActions) officialActions.hidden = !canManageOfficial;
  if (cancelBtn) cancelBtn.hidden = !canCancelOfficialEvent(ev);

  await renderEventLifecycleHistory(ev);

  modal.classList.add("active");
}

function closeEventDetails() {
  document
    .getElementById(
      "eventModalBackdrop"
    )
    .classList.remove("active");

  selectedEvent = null;
}

function handleExportIcs() {
  if (!selectedEvent) return;

  const s =
    selectedEvent.start_date.replace(
      /-/g,
      ''
    );

  const e =
    (
      selectedEvent.end_date ||
      selectedEvent.start_date
    ).replace(/-/g, '');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Acamics//Academic Calendar//EN',
    'BEGIN:VEVENT',
    `UID:cs-${selectedEvent.id}@acamics.local`,
    `DTSTART;VALUE=DATE:${s}`,
    `DTEND;VALUE=DATE:${e}`,
    `SUMMARY:${selectedEvent.title}`,
    `DESCRIPTION:${selectedEvent.description || 'Academic Event'}`,
    `LOCATION:${selectedEvent.location || 'Campus'}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob =
    new Blob(
      [ics],
      {
        type:
          'text/calendar;charset=utf-8'
      }
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;

  link.download =
    `${selectedEvent.title.replace(/\s+/g, '_')}.ics`;

  link.click();
}

// ==========================================
// 9. ADD / EDIT PERSONAL EVENT
// ==========================================
function showFormValidation(message) {
  const el =
    document.getElementById(
      "formValidationMessage"
    );

  if (!el) return;

  el.textContent = message;
  el.hidden = false;
}

function clearFormValidation() {
  const el =
    document.getElementById(
      "formValidationMessage"
    );

  if (!el) return;

  el.textContent = "";
  el.hidden = true;
}

function openAddModal(eventToEdit = null, scope = "personal") {

  if (!getCurrentUserId()) {
    alert(
      "Please sign in to create or edit personal events."
    );
    return;
  }

  const form =
    document.getElementById(
      "eventForm"
    );

  form.reset();
  eventFormScope = eventToEdit ? "personal" : scope;
  const officialAudienceFields = document.getElementById("officialAudienceFields");
  if (officialAudienceFields) officialAudienceFields.hidden = eventFormScope !== "official";
  const officialTargetCohort = document.getElementById("officialTargetCohort");
  if (officialTargetCohort) officialTargetCohort.value = "all";
  const officialAcademicPart = document.getElementById("officialAcademicPart");
  if (officialAcademicPart) officialAcademicPart.value = String(selectedAcademicPart || 1);

  document.getElementById(
    "autoDetectNotice"
  ).style.display = "none";

  if (eventToEdit) {

    editingEventId =
      eventToEdit.id;

    document.getElementById(
      "formModalTitle"
    ).textContent =
      "Edit Event";

    document.getElementById(
      "formTitle"
    ).value =
      eventToEdit.title;

    document.getElementById(
      "formCategory"
    ).value =
      eventToEdit.category;

    document.getElementById(
      "formStartDate"
    ).value =
      eventToEdit.start_date;

    document.getElementById(
      "formEndDate"
    ).value =
      eventToEdit.end_date;

    document.getElementById(
      "formStartTime"
    ).value =
      eventToEdit.start_time || "";

    document.getElementById(
      "formEndTime"
    ).value =
      eventToEdit.end_time || "";

    document.getElementById(
      "formLocation"
    ).value =
      eventToEdit.location || "";

    document.getElementById(
      "formDesc"
    ).value =
      eventToEdit.description || "";

  } else {

    editingEventId = null;

    document.getElementById(
      "formModalTitle"
    ).textContent = eventFormScope === "official"
      ? "Add Official Event"
      : "Add Personal Event";
  }

  populateOfficialCohortOptions(
    document.getElementById("formStartDate")?.value?.slice(0, 4) || new Date().getFullYear()
  );
  document
    .getElementById(
      "addEventModalBackdrop"
    )
    .classList.add("active");
}

function populateOfficialCohortOptions(calendarYear, selectedValue = "all") {
  const select = document.getElementById("officialTargetCohort");
  if (!select) return;
  const year = Number(calendarYear) || new Date().getFullYear();
  select.innerHTML = `<option value="all">All undergraduate batches</option>` +
    [0, 1, 2, 3].map(offset => {
      const cohort = year - offset;
      return `<option value="${cohort}">${escapeHtml(getCohortLabel(year, cohort))}</option>`;
    }).join("");
  select.value = [...select.options].some(option => option.value === String(selectedValue))
    ? String(selectedValue)
    : "all";
}

async function deleteSelectedPersonalEvent() {
  if (
    !selectedEvent ||
    selectedEvent.isOfficial ||
    !currentUser ||
    selectedEvent.ownerId !== currentUser.id
  ) {
    return;
  }

  if (!confirm(`Delete \"${selectedEvent.title}\" from your personal events?`)) return;

  const { data, error } = await supabase
    .from("personal_events")
    .delete()
    .eq("id", selectedEvent.id)
    .eq("owner_id", currentUser.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Personal event deletion failed:", error);
    alert(`Could not delete your event:\n\n${error.message}`);
    return;
  }
  if (!data) {
    alert("That personal event was not found for your account.");
    return;
  }

  closeEventDetails();
  await initApp();
}

// ==========================================
// 10. SETUP LISTENERS
// ==========================================
async function setupApp() {

    await loadCurrentUser();

    await initApp();
    setupInstallButton();
    await setupReminderControls();

    document.getElementById("formStartDate")?.addEventListener("change", event => {
      populateOfficialCohortOptions(event.target.value.slice(0, 4));
    });

    document
      .getElementById("postponeEventBtn")
      ?.addEventListener("click", postponeSelectedEvent);

    document.getElementById("markCompletedBtn")?.addEventListener("click", () => openLifecycleAction("complete"));
    document.getElementById("cancelOfficialEventBtn")?.addEventListener("click", () => openLifecycleAction("cancel"));
    document.getElementById("lifecycleActionForm")?.addEventListener("submit", submitLifecycleAction);
    document.getElementById("chooseLifecycleAttachmentBtn")?.addEventListener("click", () => {
      document.getElementById("lifecycleAttachmentInput")?.click();
    });
    document.getElementById("lifecycleAttachmentInput")?.addEventListener("change", event => {
      const file = event.target.files?.[0];
      document.getElementById("lifecycleAttachmentName").textContent = file?.name || "No file selected";
      document.getElementById("lifecycleActionMessage").hidden = true;
    });
    document.getElementById("cancelLifecycleActionBtn")?.addEventListener("click", closeLifecycleAction);
    document.getElementById("cancelLifecycleActionXBtn")?.addEventListener("click", closeLifecycleAction);
    document.getElementById("lifecycleActionBackdrop")?.addEventListener("click", event => {
      if (event.target.id === "lifecycleActionBackdrop") closeLifecycleAction();
    });

    if (!document.getElementById("authBtn")) {
      const authButton = document.createElement("button");

      authButton.id = "authBtn";
      authButton.type = "button";
      authButton.textContent =
        currentUser ? "Account" : "Sign In";

      authButton.style.cssText = `
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 9999;
        padding: 9px 14px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,.18);
        background: #151a24;
        color: #fff;
        cursor: pointer;
      `;

      document.body.appendChild(authButton);
    }

    // Account / authentication
    document
      .getElementById("authBtn")
      ?.addEventListener(
        "click",
        handleAuthButton
      );

    // Search
    document
      .getElementById("searchInput")
      .addEventListener(
        "input",
        (e) => {
          searchQuery =
            e.target.value;

          renderCards();
        }
      );

    // Category Auto Detection
    const titleInput =
      document.getElementById(
        "formTitle"
      );

    const descInput =
      document.getElementById(
        "formDesc"
      );

    const catSelect =
      document.getElementById(
        "formCategory"
      );

    const detectNotice =
      document.getElementById(
        "autoDetectNotice"
      );

    const runDetection = () => {

      const suggested =
        detectCategory(
          titleInput.value,
          descInput.value
        );

      catSelect.value =
        suggested;

      detectNotice.style.display =
        "inline";

      setTimeout(
        () => {
          detectNotice.style.display =
            "none";
        },
        2500
      );
    };

    titleInput.addEventListener(
      "blur",
      runDetection
    );

    // Form Submit
    document
      .getElementById("eventForm")
      .addEventListener("submit", async event => {
        event.preventDefault();
        clearFormValidation();

        const title = titleInput.value.trim();
        const category = catSelect.value;
        const startDate = document.getElementById("formStartDate").value;
        const endDate = document.getElementById("formEndDate").value || startDate;
        const startTime = document.getElementById("formStartTime").value || null;
        const endTime = document.getElementById("formEndTime").value || null;

        if (!title) return showFormValidation("Event title is required.");
        if (!startDate) return showFormValidation("Start date is required.");
        if (!validDateRange(startDate, endDate)) {
          return showFormValidation("Enter valid dates; the end date cannot be before the start date.");
        }
        if (startDate === endDate && startTime && endTime && endTime < startTime) {
          return showFormValidation("End time cannot be earlier than start time.");
        }

        const eventData = {
          title,
          category,
          start_date: startDate,
          end_date: endDate,
          start_time: startTime,
          end_time: endTime,
          location: document.getElementById("formLocation").value.trim() || "Campus",
          description: descInput.value.trim(),
          color_theme: "linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)"
        };

        if (eventFormScope === "official") {
          const selectedCohort = document.getElementById("officialTargetCohort").value;
          eventData.target_cohort_start_years = selectedCohort !== "all"
            ? [Number(selectedCohort)]
            : [];
          eventData.academic_part = Number(document.getElementById("officialAcademicPart").value);
        }

        const submitButton = document.getElementById("saveEventSubmitBtn");
        submitButton.disabled = true;

        try {
          if (eventFormScope === "official") {
            if (editingEventId) throw new Error("Editing official events is not available in this form yet.");
            const result = await callStaffAction("create_official", { event: eventData });
            if (!result) return;
          } else if (editingEventId) {
            const { data, error } = await supabase
              .from("personal_events")
              .update(eventData)
              .eq("id", editingEventId)
              .eq("owner_id", currentUser.id)
              .select("id")
              .maybeSingle();
            if (error) throw error;
            if (!data) throw new Error("That personal event was not found for your account.");
          } else {
            const { error } = await supabase
              .from("personal_events")
              .insert({ ...eventData, owner_id: currentUser.id });
            if (error) throw error;
          }

          document.getElementById("addEventModalBackdrop").classList.remove("active");
          editingEventId = null;
          if (selectedEvent) closeEventDetails();
          await initApp();
        } catch (error) {
          console.error("Could not save event:", error);
          showFormValidation(`Could not save event: ${error.message}`);
        } finally {
          submitButton.disabled = false;
        }
      });

    // Filter Buttons
    document
      .querySelectorAll(
        ".source-pill"
      )
      .forEach(
        btn => {

          btn.addEventListener(
            "click",
            () => {

              document
                .querySelectorAll(
                  ".source-pill"
                )
                .forEach(
                  b =>
                    b.classList.remove(
                      "active"
                    )
                );

              btn.classList.add(
                "active"
              );

              activeFilters.source =
                btn.dataset.source;

              renderCards();
            }
          );
        }
      );

    document
      .querySelectorAll(
        ".cat-pill"
      )
      .forEach(
        btn => {

          btn.addEventListener(
            "click",
            () => {

              document
                .querySelectorAll(
                  ".cat-pill"
                )
                .forEach(
                  b =>
                    b.classList.remove(
                      "active"
                    )
                );

              btn.classList.add(
                "active"
              );

              activeFilters.category =
                btn.dataset.category;

              renderCards();
            }
          );
        }
      );

    document
      .querySelectorAll(
        ".stat-pill"
      )
      .forEach(
        btn => {

          btn.addEventListener(
            "click",
            () => {

              document
                .querySelectorAll(
                  ".stat-pill"
                )
                .forEach(
                  b =>
                    b.classList.remove(
                      "active"
                    )
                );

              btn.classList.add(
                "active"
              );

              activeFilters.status =
                btn.dataset.status;

              renderCards();
            }
          );
        }
      );

    // Modal Open/Close Triggers
    document
      .getElementById("openAddEventBtn")
      .onclick = () => {
        if (!currentUser) {
          alert("Please sign in to create an event.");
          return;
        }
        openAddModal(null, isStaffUser() ? "official" : "personal");
      };

    document
      .getElementById(
        "cancelFormBtn"
      )
      .onclick =
      () =>
        document
          .getElementById(
            "addEventModalBackdrop"
          )
          .classList.remove(
            "active"
          );

    document
      .getElementById(
        "cancelFormXBtn"
      )
      .onclick =
      () =>
        document
          .getElementById(
            "addEventModalBackdrop"
          )
          .classList.remove(
            "active"
          );

    document
      .getElementById(
        "modalCloseBtn"
      )
      .onclick =
      closeEventDetails;

    document
      .getElementById(
        "modalDoneBtn"
      )
      .onclick =
      closeEventDetails;

    document
      .getElementById("deleteEventBtn")
      .onclick = deleteSelectedPersonalEvent;

    document
      .getElementById("deleteOfficialEventBtn")
      ?.addEventListener("click", deleteSelectedOfficialEvent);

    document
      .getElementById(
        "editEventBtn"
      )
      .onclick =
      () => {

        const target =
          selectedEvent;

        closeEventDetails();

        openAddModal(
          target
        );
      };

    // Calendar export
    document
      .getElementById(
        "exportIcsBtn"
      )
      .onclick =
      handleExportIcs;

    // Share Feature
    document
      .getElementById(
        "shareAppBtn"
      )
      .onclick =
      () => {

        if (navigator.share) {

          navigator.share({
            title:
              "Acamics Academic Calendar",

            text:
              "Autonomous Academic Calendar, Schedules & Reminders.",

            url:
              window.location.href
          }).catch(
            () => {}
          );

        } else {

          navigator.clipboard.writeText(
            window.location.href
          );

          alert(
            "App URL copied to clipboard!"
          );
        }
      };

    // Settings Modal
    document
      .getElementById(
        "settingsToggleBtn"
      )
      .onclick =
      () => {

        document
          .getElementById(
            "settingsModalBackdrop"
          )
          .classList.add(
            "active"
          );
      };

    document
      .getElementById(
        "closeSettingsBtn"
      )
      .onclick =
      () =>
        document
          .getElementById(
            "settingsModalBackdrop"
          )
          .classList.remove(
            "active"
          );

    document
      .getElementById(
        "saveSettingsDoneBtn"
      )
      .onclick =
      () =>
        document
          .getElementById(
            "settingsModalBackdrop"
          )
          .classList.remove(
            "active"
          );

    const remindersBackdrop = document.getElementById("remindersModalBackdrop");
    const closeRemindersPanel = () => remindersBackdrop.classList.remove("active");
    document.getElementById("reminderToggleBtn")?.addEventListener("click", () => {
      renderUpcomingReminderPreview(Number(document.getElementById("reminderCohortSelect").value || 2025));
      remindersBackdrop.classList.add("active");
      document.getElementById("closeRemindersBtn")?.focus();
    });
    document.getElementById("closeRemindersBtn")?.addEventListener("click", closeRemindersPanel);
    document.getElementById("closeRemindersDoneBtn")?.addEventListener("click", closeRemindersPanel);
    remindersBackdrop?.addEventListener("click", event => {
      if (event.target === remindersBackdrop) closeRemindersPanel();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && remindersBackdrop.classList.contains("active")) closeRemindersPanel();
    });

    document
      .getElementById("clearMyEventsBtn")
      .onclick = async () => {
        if (!currentUser) {
          alert("Sign in to manage your personal events.");
          return;
        }
        if (!confirm("Clear all your personal events from your account?")) return;

        const { error } = await supabase
          .from("personal_events")
          .delete()
          .eq("owner_id", currentUser.id);
        if (error) {
          console.error("Could not clear personal events:", error);
          alert(`Could not clear your events: ${error.message}`);
          return;
        }

        await initApp();
        document.getElementById("settingsModalBackdrop").classList.remove("active");
      };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupApp, { once: true });
} else {
  await setupApp();
}
