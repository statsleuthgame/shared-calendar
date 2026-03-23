// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// DOM elements
const eventList = document.getElementById('event-list');
const addBtn = document.getElementById('add-btn');
const eventModal = document.getElementById('event-modal');
const modalTitle = document.getElementById('modal-title');
const eventForm = document.getElementById('event-form');
const deleteBtn = document.getElementById('delete-btn');
const cancelBtn = document.getElementById('cancel-btn');
const eventDate = document.getElementById('event-date');
const eventEndDate = document.getElementById('event-end-date');
const calDays = document.getElementById('cal-days');
const calMonthLabel = document.getElementById('cal-month-label');
const calDayEvents = document.getElementById('cal-day-events');
const eventTime = document.getElementById('event-time');
const eventAllDay = document.getElementById('event-allday');
const calTodayBtn = document.getElementById('cal-today');
const loadingState = document.getElementById('loading-state');
const listView = document.getElementById('list-view');
const calendarView = document.getElementById('calendar-view');
const deleteConfirm = document.getElementById('delete-confirm');
const toast = document.getElementById('toast');

let unsubscribe = null;
let allEvents = [];
let calYear, calMonth;
let selectedCalDate = null;
let hasLoaded = false;

// Init calendar to current month
const initNow = new Date();
calYear = initNow.getFullYear();
calMonth = initNow.getMonth();

// Keep end date >= start date
eventDate.addEventListener('change', () => {
  if (eventEndDate.value && eventEndDate.value < eventDate.value) {
    eventEndDate.value = eventDate.value;
  }
  eventEndDate.min = eventDate.value;
});

// All-day toggle
eventAllDay.addEventListener('change', () => {
  if (eventAllDay.checked) {
    eventTime.value = '';
    eventTime.classList.add('disabled-time');
  } else {
    eventTime.classList.remove('disabled-time');
  }
});

// ---- Toast ----

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('toast-show');
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    setTimeout(() => {
      toast.classList.add('hidden');
      toast.classList.remove('toast-hide');
    }, 300);
  }, 2000);
}

// ---- Tabs ----

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    listView.classList.add('hidden');
    calendarView.classList.add('hidden');
    document.getElementById(tab.dataset.tab).classList.remove('hidden');
    if (tab.dataset.tab === 'calendar-view') renderCalendar();
  });
});

// ---- Events ----

function listenToEvents() {
  if (unsubscribe) unsubscribe();

  unsubscribe = db.collection('events')
    .onSnapshot((snapshot) => {
      allEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      allEvents.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.allDay ? -1 : b.allDay ? 1 : 0) || (a.time || '').localeCompare(b.time || ''));

      // Hide loading, show list on first load
      if (!hasLoaded) {
        hasLoaded = true;
        loadingState.classList.add('hidden');
        listView.classList.remove('hidden');
      }

      renderListView(allEvents);
      renderCalendar();
    }, (err) => {
      console.error('Firestore listen error:', err);
      if (!hasLoaded) {
        hasLoaded = true;
        loadingState.classList.add('hidden');
        listView.classList.remove('hidden');
      }
      eventList.innerHTML = `<p class="empty-state" style="color:var(--danger)">Error: ${err.message}</p>`;
    });
}

// ---- List View ----

function renderListView(events) {
  const now = new Date();
  const todayStr = formatDateISO(now);

  const upcoming = events.filter(e => {
    const endDate = e.endDate || e.date;
    return endDate >= todayStr;
  });

  if (upcoming.length === 0) {
    eventList.innerHTML = '<p class="empty-state">No upcoming events</p>';
    return;
  }

  // Group events by each day they span
  const groups = {};
  upcoming.forEach(ev => {
    const start = ev.date;
    const end = ev.endDate || ev.date;
    const startDate = parseDateStr(start);
    const endDate = parseDateStr(end);
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const key = formatDateISO(d);
      if (key >= todayStr) {
        if (!groups[key]) groups[key] = [];
        // Avoid duplicates in same group
        if (!groups[key].find(e => e.id === ev.id)) {
          groups[key].push(ev);
        }
      }
    }
  });

  const sortedDates = Object.keys(groups).sort();
  let html = '';

  for (const date of sortedDates) {
    const evts = groups[date];
    const isToday = date === todayStr;
    html += `<div class="date-group">`;
    html += `<div class="date-header${isToday ? ' today' : ''}">${formatDateLabel(date)}</div>`;

    evts.forEach(ev => {
      html += buildEventCard(ev, todayStr);
    });

    html += '</div>';
  }

  eventList.innerHTML = html;

  eventList.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('click', () => openEditModal(card.dataset.id));
  });
}

function buildEventCard(ev, todayStr) {
  const person = (ev.person || 'Both').toLowerCase();
  const timeStr = ev.allDay ? 'All Day' : formatTime(ev.time);
  const now = new Date();
  const nowTime = now.getHours() * 60 + now.getMinutes();

  let pastClass = '';
  const endDate = ev.endDate || ev.date;
  if (endDate < todayStr) {
    pastClass = ' past';
  } else if (ev.date === todayStr && !ev.endDate && ev.time) {
    const [h, m] = ev.time.split(':').map(Number);
    if (h * 60 + m < nowTime) pastClass = ' past';
  }

  const notesHtml = ev.notes ? `<div class="event-notes">${escapeHtml(ev.notes)}</div>` : '';
  const personLabel = ev.person || 'Both';

  let rangeHtml = '';
  if (ev.endDate && ev.endDate !== ev.date) {
    rangeHtml = `<span class="event-range">${formatShortDate(ev.date)} – ${formatShortDate(ev.endDate)}</span>`;
  }

  return `
    <div class="event-card${pastClass}" data-person="${person}" data-id="${ev.id}" tabindex="0" role="button">
      <div class="event-time">${timeStr}</div>
      <div class="event-details">
        <div class="event-title">${escapeHtml(ev.name)}</div>
        <div class="event-meta">
          <span class="event-person ${person}">${escapeHtml(personLabel)}</span>
          ${rangeHtml}
        </div>
        ${notesHtml}
      </div>
      <svg class="event-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
}

// ---- Calendar View ----

document.getElementById('cal-prev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  selectedCalDate = null;
  renderCalendar();
});

document.getElementById('cal-next').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  selectedCalDate = null;
  renderCalendar();
});

// Today button
calTodayBtn.addEventListener('click', () => {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  selectedCalDate = formatDateISO(now);
  renderCalendar();
});

// Swipe gestures for month navigation
let touchStartX = 0;
let touchEndX = 0;
const calGrid = document.getElementById('cal-grid');

calGrid.addEventListener('touchstart', (e) => {
  touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

calGrid.addEventListener('touchend', (e) => {
  touchEndX = e.changedTouches[0].screenX;
  const diff = touchStartX - touchEndX;
  if (Math.abs(diff) > 60) {
    if (diff > 0) {
      // Swipe left -> next month
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
    } else {
      // Swipe right -> prev month
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
    }
    selectedCalDate = null;
    renderCalendar();
  }
}, { passive: true });

function renderCalendar() {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  calMonthLabel.textContent = `${monthNames[calMonth]} ${calYear}`;

  // Show/hide Today button
  const now = new Date();
  const isCurrentMonth = calYear === now.getFullYear() && calMonth === now.getMonth();
  calTodayBtn.classList.toggle('hidden', isCurrentMonth);

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr = formatDateISO(now);

  // Build maps for calendar rendering
  const eventMap = {};
  const eventCountMap = {};
  const streakMap = {};
  const monthPrefix = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;

  allEvents.forEach(ev => {
    const start = ev.date;
    const end = ev.endDate || ev.date;
    const person = (ev.person || 'Both').toLowerCase();
    const isMultiDay = end !== start;

    const startDate = parseDateStr(start);
    const endDate = parseDateStr(end);
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const key = formatDateISO(d);
      if (key.startsWith(monthPrefix)) {
        if (!eventMap[key]) eventMap[key] = new Set();
        eventMap[key].add(person);
        eventCountMap[key] = (eventCountMap[key] || 0) + 1;

        if (isMultiDay) {
          if (!streakMap[key]) streakMap[key] = { start: false, end: false, mid: false };
          if (key === start) {
            streakMap[key].start = true;
          } else if (key === end) {
            streakMap[key].end = true;
          } else {
            streakMap[key].mid = true;
          }
        }
      }
    }
  });

  let html = '';

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedCalDate;
    const persons = eventMap[dateStr];

    let personClass = '';
    if (persons) {
      const arr = [...persons];
      if (arr.length > 1) {
        personClass = ' cal-both';
      } else if (arr.includes('both')) {
        personClass = ' cal-both';
      } else if (arr.includes('cody')) {
        personClass = ' cal-cody';
      } else if (arr.includes('stef')) {
        personClass = ' cal-stef';
      } else if (arr.includes('dogs')) {
        personClass = ' cal-dogs';
      }
    }

    const count = eventCountMap[dateStr] || 0;
    let intensityClass = '';
    if (count === 2) intensityClass = ' cal-intensity-2';
    else if (count >= 3) intensityClass = ' cal-intensity-3';

    let tallyHtml = '';
    if (count > 1) {
      const dots = Math.min(count, 5);
      tallyHtml = '<div class="cal-tally">' + '<span class="cal-tally-dot"></span>'.repeat(dots) + '</div>';
    }

    const isPayday = isPayDay(dateStr);

    let streakClass = '';
    const streak = streakMap[dateStr];
    if (streak) {
      const dayOfWeek = new Date(calYear, calMonth, d).getDay();
      const isRowStart = dayOfWeek === 0;
      const isRowEnd = dayOfWeek === 6;

      const flatLeft = (streak.mid || streak.end) && !isRowStart;
      const flatRight = (streak.mid || streak.start) && !isRowEnd;

      if (flatLeft && flatRight) streakClass = ' streak-mid';
      else if (flatLeft) streakClass = ' streak-end';
      else if (flatRight) streakClass = ' streak-start';
    }

    html += `<div class="cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${personClass}${intensityClass}${streakClass}" data-date="${dateStr}" tabindex="0" role="button" aria-label="${dateStr}">
      <span class="cal-day-num">${d}</span>
      ${isPayday ? '<span class="cal-payday">$</span>' : ''}
      ${tallyHtml}
    </div>`;
  }

  calDays.innerHTML = html;

  calDays.querySelectorAll('.cal-day:not(.empty)').forEach(day => {
    day.addEventListener('click', () => selectCalDay(day));
    day.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCalDay(day); }
    });
  });

  if (selectedCalDate) {
    renderCalDayEvents(selectedCalDate);
  } else {
    calDayEvents.innerHTML = '<p class="empty-state small">Tap a day to see events</p>';
  }
}

function selectCalDay(day) {
  selectedCalDate = day.dataset.date;
  calDays.querySelectorAll('.cal-day').forEach(d => d.classList.remove('selected'));
  day.classList.add('selected');
  renderCalDayEvents(selectedCalDate);
}

function renderCalDayEvents(dateStr) {
  const dayEvents = allEvents.filter(ev => {
    const end = ev.endDate || ev.date;
    return ev.date <= dateStr && end >= dateStr;
  });

  if (dayEvents.length === 0) {
    calDayEvents.innerHTML = `<p class="empty-state small">No events on ${formatShortDate(dateStr)}</p>`;
    return;
  }

  const todayStr = formatDateISO(new Date());
  let html = `<div class="cal-events-header">${formatDateLabel(dateStr)}</div>`;
  dayEvents.forEach(ev => {
    html += buildEventCard(ev, todayStr);
  });

  calDayEvents.innerHTML = html;

  calDayEvents.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('click', () => openEditModal(card.dataset.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditModal(card.dataset.id); }
    });
  });
}

// ---- Modal ----

addBtn.addEventListener('click', () => {
  modalTitle.textContent = 'New Event';
  eventForm.reset();
  document.getElementById('event-id').value = '';
  const defaultDate = selectedCalDate && !calendarView.classList.contains('hidden')
    ? selectedCalDate : formatDateISO(new Date());
  eventDate.value = defaultDate;
  eventEndDate.value = '';
  eventEndDate.min = eventDate.value;
  eventAllDay.checked = false;
  eventTime.classList.remove('disabled-time');
  deleteBtn.classList.add('hidden');
  openModal(eventModal);
  document.getElementById('event-name').focus();
});

cancelBtn.addEventListener('click', () => closeModal(eventModal));

// Click backdrop to close
eventModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(eventModal));

// Escape key closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!deleteConfirm.classList.contains('hidden')) {
      closeModal(deleteConfirm);
    } else if (!eventModal.classList.contains('hidden')) {
      closeModal(eventModal);
    }
  }
});

function openModal(modal) {
  modal.classList.remove('hidden');
  modal.classList.add('modal-open');
  addBtn.classList.add('fab-rotate');
}

function closeModal(modal) {
  modal.classList.add('modal-closing');
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('modal-open', 'modal-closing');
    if (eventModal.classList.contains('hidden')) {
      addBtn.classList.remove('fab-rotate');
    }
  }, 200);
}

function openEditModal(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;

  modalTitle.textContent = 'Edit Event';
  document.getElementById('event-id').value = ev.id;
  document.getElementById('event-name').value = ev.name;
  eventDate.value = ev.date;
  eventEndDate.value = ev.endDate || '';
  eventEndDate.min = ev.date;
  eventTime.value = ev.time || '';
  eventAllDay.checked = ev.allDay || false;
  if (ev.allDay) {
    eventTime.classList.add('disabled-time');
  } else {
    eventTime.classList.remove('disabled-time');
  }
  document.getElementById('event-notes').value = ev.notes || '';

  const personValue = ev.person || 'Both';
  const radio = document.querySelector(`input[name="event-person"][value="${personValue}"]`);
  if (radio) radio.checked = true;

  deleteBtn.classList.remove('hidden');
  openModal(eventModal);
}

eventForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('event-id').value;
  const personRadio = document.querySelector('input[name="event-person"]:checked');

  const data = {
    name: document.getElementById('event-name').value.trim(),
    date: eventDate.value,
    endDate: eventEndDate.value || null,
    allDay: eventAllDay.checked,
    time: eventAllDay.checked ? '' : eventTime.value,
    person: personRadio ? personRadio.value : 'Both',
    notes: document.getElementById('event-notes').value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    if (id) {
      await db.collection('events').doc(id).update(data);
      showToast('Event updated');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('events').add(data);
      showToast('Event added');
    }
    closeModal(eventModal);
  } catch (err) {
    console.error('Save error:', err);
    showToast('Failed to save event');
  }
});

// Custom delete confirmation
deleteBtn.addEventListener('click', () => {
  openModal(deleteConfirm);
});

document.getElementById('confirm-cancel').addEventListener('click', () => {
  closeModal(deleteConfirm);
});

document.getElementById('confirm-delete').addEventListener('click', async () => {
  const id = document.getElementById('event-id').value;
  if (!id) return;

  try {
    await db.collection('events').doc(id).delete();
    closeModal(deleteConfirm);
    closeModal(eventModal);
    showToast('Event deleted');
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Failed to delete event');
  }
});

deleteConfirm.querySelector('.modal-backdrop').addEventListener('click', () => {
  closeModal(deleteConfirm);
});

// ---- Helpers ----

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateStr(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateLabel(dateStr) {
  const date = parseDateStr(dateStr);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (formatDateISO(date) === formatDateISO(today)) {
    return 'Today — ' + date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (formatDateISO(date) === formatDateISO(tomorrow)) {
    return 'Tomorrow — ' + date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(dateStr) {
  const date = parseDateStr(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Payday: every other Thursday starting 2026-03-26
const PAYDAY_ANCHOR = new Date(2026, 2, 26);
function isPayDay(dateStr) {
  const date = parseDateStr(dateStr);
  if (date.getDay() !== 4) return false;
  const diff = Math.round((date - PAYDAY_ANCHOR) / (1000 * 60 * 60 * 24));
  return diff % 14 === 0;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Service Worker ----

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(r => r.unregister());
  }).then(() => {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  });
}

// ---- Start ----
listenToEvents();
