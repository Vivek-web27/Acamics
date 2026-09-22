/**
 * ACAMICS / CampusSync — Frontend Event Controller
 * Plain JavaScript, clean linear code, and no frameworks.
 */

const CURRENT_USER_ID = "student-1";

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

// Master list combining official JSON events + student localStorage items
let allEvents = [];
let editingEventId = null;

// Coordinated Filter State
let activeFilters = {
  source: "ALL",      // ALL, OFFICIAL, PERSONAL
  category: "ALL",    // ALL, Academic, Exam, Technical, etc.
  status: "ALL"       // ALL, Upcoming, Ongoing, Completed
};
let searchQuery = "";
let selectedEvent = null;

// ==========================================
// 1. SIMPLE DYNAMIC STATUS CALCULATOR
// ==========================================
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
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
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
  const current = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((target.getTime() - current.getTime()) / (1000 * 60 * 60 * 24));

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
// 5. LOCALSTORAGE LAYER
// ==========================================
function loadPersonalEvents() {
  try {
    let data = localStorage.getItem(PERSONAL_EVENTS_KEY);

    // One-time migration from the old CampusSync key so existing personal
    // events are not silently lost when moving to Acamics.
    if (data === null) {
      const legacy = localStorage.getItem(LEGACY_PERSONAL_EVENTS_KEY);
      if (legacy !== null) {
        localStorage.setItem(PERSONAL_EVENTS_KEY, legacy);
        data = legacy;
      }
    }

    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("Failed to load personal events:", e);
    return [];
  }
}

function savePersonalEvents(eventsArray) {
  localStorage.setItem(PERSONAL_EVENTS_KEY, JSON.stringify(eventsArray));
}


// ==========================================
// 6. INITIALIZATION & DATA COMBINATION
// ==========================================
async function initApp() {
  try {
    // 1. Fetch the bundled official calendar for static hosting
    const res = await fetch("data/events.json");
    const officialEvents = await res.json();

    const officialTagged = officialEvents.map(e => ({
      ...e,
      isOfficial: true,
      source: "official",
      ownerId: null,
      status: getEventStatus(e.start_date, e.end_date)
    }));

    // 2. Fetch personal student events from localStorage
    const personalEvents = loadPersonalEvents().map(e => ({
      ...e,
      status: getEventStatus(e.start_date, e.end_date)
    }));

    // Unified dataset
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

  return allEvents.filter(ev => {
    // A. Source filter
    if (activeFilters.source === "OFFICIAL" && !ev.isOfficial) return false;
    if (activeFilters.source === "PERSONAL" && (ev.isOfficial || ev.ownerId !== CURRENT_USER_ID)) return false;

    // B. Category filter
    if (activeFilters.category !== "ALL" && ev.category.toLowerCase() !== activeFilters.category.toLowerCase()) return false;

    // C. Dynamic status filter
    const status = getEventStatus(ev.start_date, ev.end_date);
    if (activeFilters.status !== "ALL" && status.toUpperCase() !== activeFilters.status.toUpperCase()) return false;

    // D. Search filter
    if (q) {
      const matchTitle = (ev.title || "").toLowerCase().includes(q);
      const matchDesc = (ev.description || "").toLowerCase().includes(q);
      const matchLoc = (ev.location || "").toLowerCase().includes(q);
      const matchCat = (ev.category || "").toLowerCase().includes(q);
      if (!matchTitle && !matchDesc && !matchLoc && !matchCat) return false;
    }

    return true;
  }).sort((a, b) => a.start_date.localeCompare(b.start_date));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function renderCards() {
  const grid = document.getElementById("eventsGrid");
  if (!grid) return;

  grid.innerHTML = "";
  const filtered = getFilteredEvents();

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">No events found matching your criteria.</div>`;
    return;
  }

  filtered.forEach(ev => {
    const card = document.createElement("div");
    card.className = "card";

    const status = getEventStatus(ev.start_date, ev.end_date);
    const dateBadgeText = formatBadgeDate(ev.start_date, ev.end_date);

    // Event-specific poster wins. Otherwise the exact event category determines
    // the permanent category artwork. If that image fails, the color theme
    // remains underneath as the safe fallback.
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

        <div class="date-badge-box">${escapeHtml(dateBadgeText)}</div>
        <div class="source-badge ${ev.isOfficial ? 'badge-official' : 'badge-personal'}">
          ${ev.isOfficial ? 'OFFICIAL' : ev.approvalStatus === 'pending' ? 'PENDING' : 'MY EVENT'}
        </div>
        <div class="status-badge status-${status.toLowerCase()}">${status}</div>
      </div>
      <div class="card-info">
        <h4 class="card-title">${escapeHtml(ev.title)}</h4>
        <p class="card-subtitle">${escapeHtml(ev.category)} • ${escapeHtml(ev.location || "To be announced")}</p>
        <p class="card-desc">${escapeHtml(ev.description || "No description provided.")}</p>
        <div class="card-cta">View Details ➔</div>
      </div>
    `;

    const posterImage = card.querySelector(".category-poster-image");
    if (posterImage) {
      posterImage.addEventListener("error", () => {
        // The parent background remains visible as the fallback.
        posterImage.remove();
      });
    }

    card.addEventListener("click", () => openEventDetails(ev));
    grid.appendChild(card);
  });
}

function updateNextEventBanner() {
  const banner = document.getElementById("nextEventBanner");
  const now = new Date().toISOString().split("T")[0];

  const upcoming = allEvents
    .filter(e => e.start_date >= now && getEventStatus(e.start_date, e.end_date) !== "Completed")
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  if (upcoming.length > 0) {
    const nextEv = upcoming[0];
    banner.style.display = "flex";
    document.getElementById("bannerTitle").textContent = nextEv.title;
    document.getElementById("bannerMeta").textContent = `${formatReadableDate(nextEv.start_date)} • ${nextEv.location || "To be announced"}`;
    document.getElementById("bannerActionBtn").onclick = () => openEventDetails(nextEv);
  } else {
    banner.style.display = "none";
  }
}

// ==========================================
// 8. EVENT DETAILS & EXPORT
// ==========================================
function openEventDetails(ev) {
  selectedEvent = ev;
  const modal = document.getElementById("eventModalBackdrop");

  document.getElementById("modalTitle").textContent = ev.title;
  document.getElementById("modalDates").textContent = ev.start_date === ev.end_date 
    ? formatReadableDate(ev.start_date)
    : `${formatReadableDate(ev.start_date)} ➔ ${formatReadableDate(ev.end_date)}`;

  document.getElementById("modalTime").textContent = ev.start_time ? `${ev.start_time} - ${ev.end_time || ''}` : "Not specified";
  document.getElementById("modalLocation").textContent = ev.location || "To be announced";
  document.getElementById("modalCategory").textContent = ev.category;
  document.getElementById("modalDescription").textContent = ev.description || "Not specified";
  document.getElementById("modalSource").textContent = ev.officialSource || (ev.isOfficial ? "Official Academic Calendar" : "Personal Student Entry");

  // Exam Encouragement Box
  const examBox = document.getElementById("modalExamNotice");
  const encouragement = ev.category === "Exams" ? getExamEncouragement(ev.start_date) : null;
  if (encouragement && getEventStatus(ev.start_date, ev.end_date) !== "Completed") {
    examBox.style.display = "block";
    examBox.innerHTML = encouragement;
  } else {
    examBox.style.display = "none";
  }

  // Permission Guard: Show Edit/Delete ONLY for student-owned events
  const personalActions = document.getElementById("modalPersonalActions");
  if (!ev.isOfficial && ev.ownerId === CURRENT_USER_ID) {
    personalActions.style.display = "inline-flex";
  } else {
    personalActions.style.display = "none";
  }

  document.getElementById("reminderToast").style.display = "none";
  modal.classList.add("active");
}

function closeEventDetails() {
  document.getElementById("eventModalBackdrop").classList.remove("active");
  selectedEvent = null;
}


function handleExportIcs() {
  if (!selectedEvent) return;
  const s = selectedEvent.start_date.replace(/-/g, '');
  const e = (selectedEvent.end_date || selectedEvent.start_date).replace(/-/g, '');
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

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${selectedEvent.title.replace(/\s+/g, '_')}.ics`;
  link.click();
}

// ==========================================
// 9. ADD / EDIT PERSONAL EVENT
// ==========================================
function showFormValidation(message) {
  const el = document.getElementById("formValidationMessage");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function clearFormValidation() {
  const el = document.getElementById("formValidationMessage");
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}

function openAddModal(eventToEdit = null) {
  const form = document.getElementById("eventForm");
  form.reset();
  document.getElementById("autoDetectNotice").style.display = "none";

  if (eventToEdit) {
    editingEventId = eventToEdit.id;
    document.getElementById("formModalTitle").textContent = "Edit Event";
    document.getElementById("formTitle").value = eventToEdit.title;
    document.getElementById("formCategory").value = eventToEdit.category;
    document.getElementById("formStartDate").value = eventToEdit.start_date;
    document.getElementById("formEndDate").value = eventToEdit.end_date;
    document.getElementById("formStartTime").value = eventToEdit.start_time || "";
    document.getElementById("formEndTime").value = eventToEdit.end_time || "";
    document.getElementById("formLocation").value = eventToEdit.location || "";
    document.getElementById("formDesc").value = eventToEdit.description || "";
  } else {
    editingEventId = null;
    document.getElementById("formModalTitle").textContent = "Add Event";
  }

  document.getElementById("addEventModalBackdrop").classList.add("active");
}

function deleteSelectedPersonalEvent() {
  if (!selectedEvent || selectedEvent.isOfficial) return;

  const confirmed = confirm(`Are you sure you want to delete "${selectedEvent.title}"?`);
  if (!confirmed) return;

  let personalList = loadPersonalEvents();
  personalList = personalList.filter(e => e.id !== selectedEvent.id);
  savePersonalEvents(personalList);

  closeEventDetails();
  initApp();
}

// ==========================================
// 10. SETUP LISTENERS
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  initApp();

  // Search
  document.getElementById("searchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderCards();
  });

  // Category Auto Detection on Input
  const titleInput = document.getElementById("formTitle");
  const descInput = document.getElementById("formDesc");
  const catSelect = document.getElementById("formCategory");
  const detectNotice = document.getElementById("autoDetectNotice");

  const runDetection = () => {
    const suggested = detectCategory(titleInput.value, descInput.value);
    catSelect.value = suggested;
    detectNotice.style.display = "inline";
    setTimeout(() => { detectNotice.style.display = "none"; }, 2500);
  };
  titleInput.addEventListener("blur", runDetection);

  // Form Submit
  document.getElementById("eventForm").addEventListener("submit", (e) => {
    e.preventDefault();
    clearFormValidation();

    const title = titleInput.value.trim();
    const category = catSelect.value;
    const start = document.getElementById("formStartDate").value;
    const end = document.getElementById("formEndDate").value || start;
    const startTime = document.getElementById("formStartTime").value;
    const endTime = document.getElementById("formEndTime").value;

    if (!title) {
      showFormValidation("Event title is required.");
      return;
    }
    if (!start) {
      showFormValidation("Start date is required.");
      return;
    }
    if (end < start) {
      showFormValidation("End date cannot be earlier than start date.");
      return;
    }
    if (start === end && startTime && endTime && endTime < startTime) {
      showFormValidation("End time cannot be earlier than start time.");
      return;
    }

    let personalList = loadPersonalEvents();

    if (editingEventId) {
      const idx = personalList.findIndex(e => e.id === editingEventId);
      if (idx >= 0) {
        personalList[idx] = {
          ...personalList[idx],
          title,
          category,
          start_date: start,
          end_date: end,
          start_time: startTime,
          end_time: endTime,
          location: document.getElementById("formLocation").value.trim() || "Campus",
          description: descInput.value.trim()
        };
      }
    } else {
      personalList.push({
        id: "pers_" + Date.now(),
        title,
        category,
        start_date: start,
        end_date: end,
        start_time: startTime,
        end_time: endTime,
        location: document.getElementById("formLocation").value.trim() || "Campus",
        description: descInput.value.trim(),
        isOfficial: false,
        source: "personal",
        ownerId: CURRENT_USER_ID,
        approvalStatus: "approved",
        color_theme: "linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)"
      });
    }

    savePersonalEvents(personalList);
    document.getElementById("addEventModalBackdrop").classList.remove("active");
    if (selectedEvent) closeEventDetails();
    initApp();
  });

  // Filter Buttons
  document.querySelectorAll(".source-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".source-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilters.source = btn.dataset.source;
      renderCards();
    });
  });

  document.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cat-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilters.category = btn.dataset.category;
      renderCards();
    });
  });

  document.querySelectorAll(".stat-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".stat-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilters.status = btn.dataset.status;
      renderCards();
    });
  });

  // Modal Open/Close Triggers
  document.getElementById("openAddEventBtn").onclick = () => openAddModal(null);
  document.getElementById("cancelFormBtn").onclick = () => document.getElementById("addEventModalBackdrop").classList.remove("active");
  document.getElementById("cancelFormXBtn").onclick = () => document.getElementById("addEventModalBackdrop").classList.remove("active");

  document.getElementById("modalCloseBtn").onclick = closeEventDetails;
  document.getElementById("modalDoneBtn").onclick = closeEventDetails;
  document.getElementById("deleteEventBtn").onclick = deleteSelectedPersonalEvent;
  document.getElementById("editEventBtn").onclick = () => {
    const target = selectedEvent;
    closeEventDetails();
    openAddModal(target);
  };
  // Calendar export (works fully offline/static; no server required)
  document.getElementById("exportIcsBtn").onclick = handleExportIcs;


  // Share Feature
  document.getElementById("shareAppBtn").onclick = () => {
    if (navigator.share) {
      navigator.share({
        title: "Acamics Academic Calendar",
        text: "Autonomous Academic Calendar, Schedules & Reminders.",
        url: window.location.href
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("App URL copied to clipboard!");
    }
  };

  // Settings Modal
  document.getElementById("settingsToggleBtn").onclick = () => {
    document.getElementById("settingsModalBackdrop").classList.add("active");
  };
  document.getElementById("closeSettingsBtn").onclick = () => document.getElementById("settingsModalBackdrop").classList.remove("active");
  document.getElementById("saveSettingsDoneBtn").onclick = () => document.getElementById("settingsModalBackdrop").classList.remove("active");
  document.getElementById("clearMyEventsBtn").onclick = () => {
    if (confirm("Clear all your personal events?")) {
      savePersonalEvents([]);
      initApp();
      document.getElementById("settingsModalBackdrop").classList.remove("active");
    }
  };
});