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

let unsubscribe = null;

// Keep end date >= start date
eventDate.addEventListener('change', () => {
  if (eventEndDate.value && eventEndDate.value < eventDate.value) {
    eventEndDate.value = eventDate.value;
  }
  eventEndDate.min = eventDate.value;
});

// ---- Events ----

function listenToEvents() {
  if (unsubscribe) unsubscribe();

  // Single orderBy to avoid needing a composite index
  unsubscribe = db.collection('events')
    .orderBy('date')
    .onSnapshot((snapshot) => {
      const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort by date then time client-side
      events.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
      renderEvents(events);
    }, (err) => {
      console.error('Firestore listen error:', err);
      eventList.innerHTML = `<p class="empty-state" style="color:#ff4a6a">Error: ${err.message}</p>`;
    });
}

function renderEvents(events) {
  const now = new Date();
  const todayStr = formatDateISO(now);

  // Show events where the end date (or start date if no end) is today or later
  const upcoming = events.filter(e => {
    const endDate = e.endDate || e.date;
    return endDate >= todayStr;
  });

  if (upcoming.length === 0) {
    eventList.innerHTML = '<p class="empty-state">No upcoming events</p>';
    return;
  }

  // Group by start date
  const groups = {};
  upcoming.forEach(ev => {
    if (!groups[ev.date]) groups[ev.date] = [];
    groups[ev.date].push(ev);
  });

  // Sort date keys
  const sortedDates = Object.keys(groups).sort();

  let html = '';
  const nowTime = now.getHours() * 60 + now.getMinutes();

  for (const date of sortedDates) {
    const evts = groups[date];
    const isToday = date === todayStr;
    const dateLabel = formatDateLabel(date);
    html += `<div class="date-group">`;
    html += `<div class="date-header${isToday ? ' today' : ''}">${dateLabel}</div>`;

    evts.forEach(ev => {
      const person = (ev.person || 'Both').toLowerCase();
      const timeStr = formatTime(ev.time);

      let pastClass = '';
      const endDate = ev.endDate || ev.date;
      if (endDate < todayStr) {
        pastClass = ' past';
      } else if (isToday && !ev.endDate && ev.time) {
        const [h, m] = ev.time.split(':').map(Number);
        if (h * 60 + m < nowTime) pastClass = ' past';
      }

      const notesHtml = ev.notes ? `<div class="event-notes">${escapeHtml(ev.notes)}</div>` : '';
      const personLabel = ev.person || 'Both';

      // Date range badge
      let rangeHtml = '';
      if (ev.endDate && ev.endDate !== ev.date) {
        rangeHtml = `<span class="event-range">${formatShortDate(ev.date)} – ${formatShortDate(ev.endDate)}</span>`;
      }

      html += `
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
    });

    html += '</div>';
  }

  eventList.innerHTML = html;

  // Click to edit
  eventList.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('click', () => openEditModal(card.dataset.id, events));
  });
}

// ---- Modal ----

addBtn.addEventListener('click', () => {
  modalTitle.textContent = 'New Event';
  eventForm.reset();
  document.getElementById('event-id').value = '';
  eventDate.value = formatDateISO(new Date());
  eventEndDate.value = '';
  eventEndDate.min = eventDate.value;
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

function openEditModal(eventId, events) {
  const ev = events.find(e => e.id === eventId);
  if (!ev) return;

  modalTitle.textContent = 'Edit Event';
  document.getElementById('event-id').value = ev.id;
  document.getElementById('event-name').value = ev.name;
  eventDate.value = ev.date;
  eventEndDate.value = ev.endDate || '';
  eventEndDate.min = ev.date;
  document.getElementById('event-time').value = ev.time;
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
    time: document.getElementById('event-time').value,
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

function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
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
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Service Worker ----

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => {
    console.log('SW registration failed:', err);
  });
}

// ---- Start ----
listenToEvents();
