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

let unsubscribe = null;
let allEvents = [];
let calYear, calMonth;
let selectedCalDate = null;

// Init calendar to current month
const now = new Date();
calYear = now.getFullYear();
calMonth = now.getMonth();

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

// ---- Tabs ----

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
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
      renderListView(allEvents);
      renderCalendar();
    }, (err) => {
      console.error('Firestore listen error:', err);
      eventList.innerHTML = `<p class="empty-state" style="color:#ff4a6a">Error: ${err.message}</p>`;
    });
}

// ---- List View ----

function renderListView(events) {
  const todayStr = formatDateISO(new Date());
  const nowTime = now.getHours() * 60 + now.getMinutes();

  const upcoming = events.filter(e => {
    const endDate = e.endDate || e.date;
    return endDate >= todayStr;
  });

  if (upcoming.length === 0) {
    eventList.innerHTML = '<p class="empty-state">No upcoming events</p>';
    return;
  }

  const groups = {};
  upcoming.forEach(ev => {
    if (!groups[ev.date]) groups[ev.date] = [];
    groups[ev.date].push(ev);
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
    <div class="event-card${pastClass}" data-person="${person}" data-id="${ev.id}">
      <div class="event-time">${timeStr}</div>
      <div class="event-details">
        <div class="event-title">${escapeHtml(ev.name)}</div>
        <div class="event-meta">
          <span class="event-person ${person}">${escapeHtml(personLabel)}</span>
          ${rangeHtml}
        </div>
        ${notesHtml}
      </div>
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

function renderCalendar() {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  calMonthLabel.textContent = `${monthNames[calMonth]} ${calYear}`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr = formatDateISO(new Date());

  // Build maps for calendar rendering
  const eventMap = {};      // date -> Set of person names
  const eventCountMap = {}; // date -> total event count
  const streakMap = {};     // date -> { start, end, mid } for multi-day events
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

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedCalDate;
    const persons = eventMap[dateStr];

    // Determine highlight class based on person(s)
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

    // Intensity level based on event count (1=light, 2=medium, 3+=heavy)
    const count = eventCountMap[dateStr] || 0;
    let intensityClass = '';
    if (count === 2) intensityClass = ' cal-intensity-2';
    else if (count >= 3) intensityClass = ' cal-intensity-3';

    // Tally dots for multiple events
    let tallyHtml = '';
    if (count > 1) {
      const dots = Math.min(count, 5); // cap at 5 dots
      tallyHtml = '<div class="cal-tally">' + '<span class="cal-tally-dot"></span>'.repeat(dots) + '</div>';
    }

    const isPayday = isPayDay(dateStr);

    // Streak classes for connected multi-day highlights
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

    html += `<div class="cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${personClass}${intensityClass}${streakClass}" data-date="${dateStr}">
      <span class="cal-day-num">${d}</span>
      ${isPayday ? '<span class="cal-payday">$</span>' : ''}
      ${tallyHtml}
    </div>`;
  }

  calDays.innerHTML = html;

  // Click handler for days
  calDays.querySelectorAll('.cal-day:not(.empty)').forEach(day => {
    day.addEventListener('click', () => {
      selectedCalDate = day.dataset.date;
      // Update selected state
      calDays.querySelectorAll('.cal-day').forEach(d => d.classList.remove('selected'));
      day.classList.add('selected');
      renderCalDayEvents(selectedCalDate);
    });
  });

  // Re-render selected day events if one is selected
  if (selectedCalDate) {
    renderCalDayEvents(selectedCalDate);
  } else {
    calDayEvents.innerHTML = '<p class="empty-state small">Tap a day to see events</p>';
  }
}

function renderCalDayEvents(dateStr) {
  // Find events that overlap this date
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
  });
}

// ---- Modal ----

addBtn.addEventListener('click', () => {
  modalTitle.textContent = 'New Event';
  eventForm.reset();
  document.getElementById('event-id').value = '';
  // If in calendar view with a selected date, use that date
  const defaultDate = selectedCalDate && !document.getElementById('calendar-view').classList.contains('hidden')
    ? selectedCalDate : formatDateISO(new Date());
  eventDate.value = defaultDate;
  eventEndDate.value = '';
  eventEndDate.min = eventDate.value;
  eventAllDay.checked = false;
  eventTime.classList.remove('disabled-time');
  deleteBtn.classList.add('hidden');
  eventModal.classList.remove('hidden');
  document.getElementById('event-name').focus();
});

cancelBtn.addEventListener('click', closeModal);

eventModal.addEventListener('click', (e) => {
  if (e.target === eventModal) closeModal();
});

function closeModal() {
  eventModal.classList.add('hidden');
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
  eventModal.classList.remove('hidden');
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
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('events').add(data);
    }
    closeModal();
  } catch (err) {
    console.error('Save error:', err);
    alert('Failed to save event. Please try again.');
  }
});

deleteBtn.addEventListener('click', async () => {
  const id = document.getElementById('event-id').value;
  if (!id) return;
  if (!confirm('Delete this event?')) return;

  try {
    await db.collection('events').doc(id).delete();
    closeModal();
  } catch (err) {
    console.error('Delete error:', err);
    alert('Failed to delete event.');
  }
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
const PAYDAY_ANCHOR = new Date(2026, 2, 26); // Thu Mar 26 2026
function isPayDay(dateStr) {
  const date = parseDateStr(dateStr);
  if (date.getDay() !== 4) return false; // Not Thursday
  const diff = Math.round((date - PAYDAY_ANCHOR) / (1000 * 60 * 60 * 24));
  return diff % 14 === 0;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
