import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://axceorzwzfuyuaeoswgv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hZPUC-ejVolPLx8_O7YktA_G4BTiejk";

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

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
  if (!button) return;

  if (currentUser) {
    button.title = `Signed in as ${currentUser.email || "User"}`;
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
    await initApp();
    return;
  }

  const mode = prompt(
    "Account\n\nType SIGN IN to log in, or SIGN UP to create an account."
  );

  if (!mode) return;

  const normalizedMode = mode.trim().toUpperCase();

  if (normalizedMode !== "SIGN IN" && normalizedMode !== "SIGN UP") {
    alert("Please type exactly SIGN IN or SIGN UP.");
    return;
  }

  const email = prompt("Enter your email address:");
  if (!email) return;

  const password = prompt("Enter your password:");
  if (!password) return;

  if (normalizedMode === "SIGN UP") {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password
    });

    if (error) {
      alert(`Sign up failed:\n\n${error.message}`);
      return;
    }

    if (data.session && data.user) {
      currentUser = data.user;

      // Load the user's profile and role from Supabase.
      await loadCurrentUser();

      alert(`Account created and signed in as ${currentUser.email}.`);
      await initApp();
    } else {
      alert(
        "Account created successfully.\n\n" +
        "Please check your email and confirm your account, then use Sign In."
      );
    }

    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });

  if (error) {
    alert(`Sign in failed:\n\n${error.message}`);
    return;
  }

  currentUser = data.user;

  // Load the user's profile and role from Supabase.
  await loadCurrentUser();

  alert(`Signed in as ${currentUser.email}.`);
  await initApp();
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

// Coordinated Filter State
let activeFilters = {
  source: "ALL",
  category: "ALL",
  status: "ALL"
};

let searchQuery = "";
let selectedEvent = null;

// ==========================================
// 1. SIMPLE DYNAMIC STATUS CALCULATOR
// ==========================================
function getDisplayStatus(ev) {
  if (ev?.lifecycle_status === "postponed") {
    return "Postponed";
  }

  if (ev?.lifecycle_status === "completed") {
    return "Completed";
  }

  if (ev?.lifecycle_status === "ongoing") {
    return "Ongoing";
  }

  return getEventStatus(
    ev?.start_date,
    ev?.end_date
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

    renderCards();
    updateNextEventBanner();
  } catch (err) {
    console.error("Initialization error:", err);
  }
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

      // B. Category filter
      if (
        activeFilters.category !== "ALL" &&
        ev.category.toLowerCase() !==
        activeFilters.category.toLowerCase()
      ) {
        return false;
      }

      // C. Dynamic status filter
      const status = getDisplayStatus(ev);

      if (
        activeFilters.status !== "ALL" &&
        status.toUpperCase() !==
        activeFilters.status.toUpperCase()
      ) {
        return false;
      }

      // D. Search filter
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

        <div class="status-badge status-${status.toLowerCase()}">
          ${status}
        </div>

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

    card.addEventListener(
      "click",
      () => openEventDetails(ev)
    );

    grid.appendChild(card);
  });
}

function updateNextEventBanner() {
  const banner =
    document.getElementById("nextEventBanner");

  const now =
    new Date().toISOString().split("T")[0];

  const upcoming = allEvents
    .filter(
      e =>
        e.start_date >= now &&
        getDisplayStatus(e) !== "Completed" &&
        getDisplayStatus(e) !== "Postponed"
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

  const actionPassword = currentUserRole === "teacher"
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

    const reason = prompt(
      "Why is this official event being postponed?\n\nA reason is required:"
    );
    if (reason === null) return;
    if (!reason.trim()) {
      alert("A postponement reason is required.");
      return;
    }

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

    try {
      const result = await callStaffAction("postpone_official", {
        eventId: Number(selectedEvent.id),
        newStartDate,
        newEndDate,
        reason: reason.trim()
      });
      if (!result) return;
    } catch (error) {
      console.error("Official event postponement failed:", error);
      alert(`Could not postpone event:\n\n${error.message}`);
      return;
    }

    alert("Official event postponed successfully.");
  }

  closeEventDetails();
  await initApp();
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
    postponeBtn.hidden = !(canManageOfficial || canReschedulePersonal);
    postponeBtn.textContent = ev.isOfficial ? "Postpone Event" : "Reschedule Event";
  }
  if (officialActions) officialActions.hidden = !canManageOfficial;

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

  document
    .getElementById(
      "addEventModalBackdrop"
    )
    .classList.add("active");
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
document.addEventListener(
  "DOMContentLoaded",
  async () => {

    await loadCurrentUser();

    await initApp();

    document
      .getElementById("postponeEventBtn")
      ?.addEventListener("click", postponeSelectedEvent);

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
);
