/**
 * EventDetailsModal Component
 * Implements strict hierarchy: Primary Key Details -> Academic Targets -> Notes -> Actions
 */
class EventDetailsModal {
  constructor() {
    this.selectedEvent = null;
    this.previouslyFocusedElement = null;
    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop';
    this.backdrop.id = 'eventModalBackdrop';
    this.backdrop.setAttribute('aria-hidden', 'true');

    this.backdrop.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <!-- Header -->
        <header class="modal-header">
          <div class="modal-badge-group">
            <span class="modal-tag" id="modalTypeTag">Academic</span>
            <span class="modal-status" id="modalStatusTag">Upcoming</span>
          </div>
          <button class="modal-close-btn" id="modalCloseBtn" aria-label="Close dialog">✕</button>
        </header>

        <!-- Body -->
        <div class="modal-body">
          <h2 class="modal-title" id="modalTitle">Event Title</h2>

          <!-- Hero Schedule Strip -->
          <div class="modal-highlight-box">
            <div class="highlight-item">
              <span class="h-label">📅 DATES</span>
              <span class="h-value" id="modalDates">Date info</span>
            </div>
            <div class="highlight-item">
              <span class="h-label">🕐 TIME</span>
              <span class="h-value" id="modalTime">Not specified</span>
            </div>
            <div class="highlight-item">
              <span class="h-label">📍 LOCATION</span>
              <span class="h-value" id="modalLocation">To be announced</span>
            </div>
          </div>

          <!-- Academic Scope Section -->
          <div class="modal-section-title">ACADEMIC DETAILS</div>
          <div class="modal-grid">
            <div class="info-block">
              <span class="info-label">Department</span>
              <span class="info-val" id="modalDepartment">All Departments</span>
            </div>
            <div class="info-block">
              <span class="info-label">Academic Year</span>
              <span class="info-val" id="modalAcademicYear">2026–27</span>
            </div>
            <div class="info-block">
              <span class="info-label">Target Cohort</span>
              <span class="info-val" id="modalTarget">All Years • All Sections</span>
            </div>
            <div class="info-block">
              <span class="info-label">Organizer</span>
              <span class="info-val" id="modalOrganizer">Not specified</span>
            </div>
          </div>

          <!-- Description Section -->
          <div class="modal-section-title">ABOUT THIS EVENT</div>
          <p class="modal-description" id="modalDescription">Not specified</p>

          <!-- Contextual Exam/Fest Note -->
          <div class="friendly-notice" id="modalFriendlyNote" style="display: none;"></div>

          <!-- Source Integrity Tag -->
          <div class="modal-source-tag">
            <i class="fa-solid fa-file-circle-check"></i>
            <span>Official Source: <strong id="modalSource">MIT CSN Academic Calendar AY 2026-27</strong></span>
          </div>
        </div>

        <!-- Footer Actions -->
        <footer class="modal-footer">
          <button class="btn btn-outline" id="modalExportIcsBtn">
            <i class="fa-regular fa-calendar-plus"></i> Add to Calendar (.ics)
          </button>
          <button class="btn btn-outline" id="modalReminderBtn">
            <i class="fa-regular fa-bell"></i> Remind Me
          </button>
          <button class="btn btn-primary" id="modalDoneBtn">Close</button>
        </footer>
      </div>
    `;

    document.body.appendChild(this.backdrop);
  }

  bindEvents() {
    const closeBtn = this.backdrop.querySelector('#modalCloseBtn');
    const doneBtn = this.backdrop.querySelector('#modalDoneBtn');
    const reminderBtn = this.backdrop.querySelector('#modalReminderBtn');
    const icsBtn = this.backdrop.querySelector('#modalExportIcsBtn');

    closeBtn.addEventListener('click', () => this.close());
    doneBtn.addEventListener('click', () => this.close());

    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });

    reminderBtn.addEventListener('click', () => {
      if (!this.selectedEvent) return;
      window.openReminderPicker(this.selectedEvent);
    });

    icsBtn.addEventListener('click', () => {
      if (!this.selectedEvent) return;
      window.downloadIcsEvent(this.selectedEvent);
    });
  }

  isOpen() {
    return this.backdrop.classList.contains('active');
  }

  open(eventData) {
    this.selectedEvent = eventData;
    this.previouslyFocusedElement = document.activeElement;

    // Title & Badges
    document.getElementById('modalTitle').textContent = eventData.title || 'Untitled Activity';
    document.getElementById('modalTypeTag').textContent = eventData.category || eventData.event_type || 'Academic';
    
    // Dynamic status badge
    const statusTag = document.getElementById('modalStatusTag');
    statusTag.textContent = eventData.status;
    statusTag.className = `modal-status status-${eventData.status.toLowerCase()}`;

    // Dates
    document.getElementById('modalDates').textContent = formatDateRange(eventData.start_date, eventData.end_date);

    // Time
    document.getElementById('modalTime').textContent = formatTimeRange(eventData.start_time, eventData.end_time);

    // Location
    document.getElementById('modalLocation').textContent = eventData.location || 'To be announced';

    // Academic Metadata
    document.getElementById('modalDepartment').textContent = eventData.department || 'All Departments';
    document.getElementById('modalAcademicYear').textContent = eventData.academic_year || '2026–27';
    
    const yearStr = eventData.year || 'All Years';
    const secStr = eventData.section || 'All Sections';
    document.getElementById('modalTarget').textContent = `${yearStr} • ${secStr}`;
    
    document.getElementById('modalOrganizer').textContent = eventData.organizer || 'Not specified';
    document.getElementById('modalSource').textContent = eventData.source || 'MIT CSN Academic Calendar AY 2026-27';

    // Description
    const descText = (eventData.description || '').trim();
    document.getElementById('modalDescription').textContent = descText || 'Not specified';

    // Exam encouragement
    const noteEl = document.getElementById('modalFriendlyNote');
    const lowerTitle = (eventData.title || '').toLowerCase();
    const lowerCat = (eventData.category || '').toLowerCase();

    if (lowerTitle.includes('in-semester') || lowerTitle.includes('ise') || lowerCat === 'exams') {
      noteEl.style.display = 'block';
      noteEl.innerHTML = `✨ <strong>Best of luck for your exams!</strong> Stay calm and give it your best shot! 🍀😊`;
    } else if (lowerTitle.includes('diwali') || lowerCat === 'breaks') {
      noteEl.style.display = 'block';
      noteEl.innerHTML = `🪔 <strong>Happy Holidays!</strong> Have a restful and wonderful break with family! ✨`;
    } else {
      noteEl.style.display = 'none';
      noteEl.innerHTML = '';
    }

    this.backdrop.classList.add('active');
    this.backdrop.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      this.backdrop.querySelector('#modalCloseBtn').focus();
    }, 50);
  }

  close() {
    this.backdrop.classList.remove('active');
    this.backdrop.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    this.selectedEvent = null;

    if (this.previouslyFocusedElement && typeof this.previouslyFocusedElement.focus === 'function') {
      this.previouslyFocusedElement.focus();
    }
  }
}

window.eventDetailsModal = new EventDetailsModal();