(function () {
'use strict';

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();

// DOM elements
var eventList = document.getElementById('event-list');
var addBtn = document.getElementById('add-btn');
var eventModal = document.getElementById('event-modal');
var modalTitle = document.getElementById('modal-title');
var eventForm = document.getElementById('event-form');
var deleteBtn = document.getElementById('delete-btn');
var cancelBtn = document.getElementById('cancel-btn');
var saveBtn = document.getElementById('save-btn');
var eventDate = document.getElementById('event-date');
var eventEndDate = document.getElementById('event-end-date');
var calDays = document.getElementById('cal-days');
var calMonthLabel = document.getElementById('cal-month-label');
var calDayEvents = document.getElementById('cal-day-events');
var eventTime = document.getElementById('event-time');
var eventAllDay = document.getElementById('event-allday');
var calTodayBtn = document.getElementById('cal-today');
var loadingState = document.getElementById('loading-state');
var listView = document.getElementById('list-view');
var calendarView = document.getElementById('calendar-view');
var deleteConfirm = document.getElementById('delete-confirm');
var toast = document.getElementById('toast');
var calGrid = document.getElementById('cal-grid');

var unsubscribe = null;
var allEvents = [];
var calYear, calMonth;
var selectedCalDate = null;
var hasLoaded = false;
var toastTimer1 = null;
var toastTimer2 = null;
var touchStartX = 0;
var touchStartY = 0;
var saving = false;

// Init calendar to current month
var initNow = new Date();
calYear = initNow.getFullYear();
calMonth = initNow.getMonth();

// ---- Utilities ----

function formatDateISO(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function parseDateStr(str) {
  if (!str || typeof str !== 'string') return new Date(NaN);
  var parts = str.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return new Date(NaN);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function forEachDayInRange(startStr, endStr, callback) {
  var start = parseDateStr(startStr);
  var end = parseDateStr(endStr);
  if (isNaN(start) || isNaN(end)) return;
  for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    callback(formatDateISO(d));
  }
}

function navigateMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  selectedCalDate = null;
  renderCalendar();
}

function formatDateLabel(dateStr) {
  var date = parseDateStr(dateStr);
  if (isNaN(date)) return dateStr;
  var today = new Date();
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var todayStr = formatDateISO(today);
  var tomorrowStr = formatDateISO(tomorrow);

  if (dateStr === todayStr) {
    return 'Today — ' + date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (dateStr === tomorrowStr) {
    return 'Tomorrow — ' + date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(dateStr) {
  var date = parseDateStr(dateStr);
  if (isNaN(date)) return dateStr;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  var parts = timeStr.split(':').map(Number);
  if (parts.length < 2) return timeStr;
  var h = parts[0], m = parts[1];
  var ampm = h >= 12 ? 'PM' : 'AM';
  var hour = h % 12 || 12;
  return hour + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

// Payday: every other Thursday starting 2026-03-26
var PAYDAY_ANCHOR = new Date(2026, 2, 26);
function isPayDay(dateStr) {
  var date = parseDateStr(dateStr);
  if (isNaN(date) || date.getDay() !== 4) return false;
  var diff = Math.floor((date - PAYDAY_ANCHOR) / (1000 * 60 * 60 * 24));
  return diff % 14 === 0;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Toast ----

function showToast(message) {
  if (toastTimer1) clearTimeout(toastTimer1);
  if (toastTimer2) clearTimeout(toastTimer2);
  toast.textContent = message;
  toast.classList.remove('hidden', 'toast-hide');
  toast.classList.add('toast-show');
  toastTimer1 = setTimeout(function () {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    toastTimer2 = setTimeout(function () {
      toast.classList.add('hidden');
      toast.classList.remove('toast-hide');
      toastTimer1 = null;
      toastTimer2 = null;
    }, 300);
  }, 2000);
}

// ---- Form Handlers ----

eventDate.addEventListener('change', function () {
  if (eventEndDate.value && eventEndDate.value < eventDate.value) {
    eventEndDate.value = eventDate.value;
  }
  eventEndDate.min = eventDate.value;
});

eventAllDay.addEventListener('change', function () {
  if (eventAllDay.checked) {
    eventTime.value = '';
    eventTime.classList.add('disabled-time');
  } else {
    eventTime.classList.remove('disabled-time');
  }
});

// ---- Tabs ----

document.querySelectorAll('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    listView.classList.add('hidden');
    calendarView.classList.add('hidden');
    document.getElementById(tab.dataset.tab).classList.remove('hidden');
    if (tab.dataset.tab === 'calendar-view') renderCalendar();
  });
});

// ---- Events (Firestore) ----

function listenToEvents() {
  if (unsubscribe) unsubscribe();

  unsubscribe = db.collection('events')
    .onSnapshot(function (snapshot) {
      allEvents = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
      allEvents.sort(function (a, b) {
        return (a.date || '').localeCompare(b.date || '') ||
               (a.allDay ? -1 : b.allDay ? 1 : 0) ||
               (a.time || '').localeCompare(b.time || '');
      });

      if (!hasLoaded) {
        hasLoaded = true;
        loadingState.classList.add('hidden');
        listView.classList.remove('hidden');
      }

      renderListView();
      if (!calendarView.classList.contains('hidden')) renderCalendar();
    }, function (err) {
      console.error('Firestore listen error:', err);
      if (!hasLoaded) {
        hasLoaded = true;
        loadingState.classList.add('hidden');
        listView.classList.remove('hidden');
      }
      eventList.innerHTML = '<p class="empty-state" style="color:var(--danger)">Error: ' + escapeHtml(err.message) + '</p>';
    });
}

// ---- List View ----

function renderListView() {
  var now = new Date();
  var todayStr = formatDateISO(now);

  var upcoming = allEvents.filter(function (e) {
    return (e.endDate || e.date) >= todayStr;
  });

  if (upcoming.length === 0) {
    eventList.innerHTML = '<p class="empty-state">No upcoming events</p>';
    return;
  }

  var groups = {};
  upcoming.forEach(function (ev) {
    forEachDayInRange(ev.date, ev.endDate || ev.date, function (key) {
      if (key >= todayStr) {
        if (!groups[key]) groups[key] = [];
        if (!groups[key].find(function (e) { return e.id === ev.id; })) {
          groups[key].push(ev);
        }
      }
    });
  });

  var sortedDates = Object.keys(groups).sort();
  var html = '';

  sortedDates.forEach(function (date) {
    var evts = groups[date];
    var isToday = date === todayStr;
    html += '<div class="date-group">';
    html += '<div class="date-header' + (isToday ? ' today' : '') + '">' + formatDateLabel(date) + '</div>';
    evts.forEach(function (ev) { html += buildEventCard(ev, todayStr); });
    html += '</div>';
  });

  eventList.innerHTML = html;
}

function buildEventCard(ev, todayStr) {
  var person = (ev.person || 'Both').toLowerCase();
  var timeStr = ev.allDay ? 'All Day' : formatTime(ev.time);
  var now = new Date();
  var nowTime = now.getHours() * 60 + now.getMinutes();

  var pastClass = '';
  var endDate = ev.endDate || ev.date;
  if (endDate < todayStr) {
    pastClass = ' past';
  } else if (ev.date === todayStr && !ev.endDate && ev.time) {
    var parts = ev.time.split(':').map(Number);
    if (parts[0] * 60 + parts[1] < nowTime) pastClass = ' past';
  }

  var notesHtml = ev.notes ? '<div class="event-notes">' + escapeHtml(ev.notes) + '</div>' : '';
  var personLabel = ev.person || 'Both';
  var rangeHtml = '';
  if (ev.endDate && ev.endDate !== ev.date) {
    rangeHtml = '<span class="event-range">' + formatShortDate(ev.date) + ' – ' + formatShortDate(ev.endDate) + '</span>';
  }

  return '<div class="event-card' + pastClass + '" data-person="' + person + '" data-id="' + ev.id + '" tabindex="0" role="button">' +
    '<div class="event-time">' + timeStr + '</div>' +
    '<div class="event-details">' +
      '<div class="event-title">' + escapeHtml(ev.name) + '</div>' +
      '<div class="event-meta">' +
        '<span class="event-person ' + person + '">' + escapeHtml(personLabel) + '</span>' +
        rangeHtml +
      '</div>' +
      notesHtml +
    '</div>' +
    '<svg class="event-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
  '</div>';
}

// Event delegation for list view
eventList.addEventListener('click', function (e) {
  var card = e.target.closest('.event-card');
  if (card) openEditModal(card.dataset.id);
});
eventList.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') {
    var card = e.target.closest('.event-card');
    if (card) { e.preventDefault(); openEditModal(card.dataset.id); }
  }
});

// ---- Calendar View ----

document.getElementById('cal-prev').addEventListener('click', function () { navigateMonth(-1); });
document.getElementById('cal-next').addEventListener('click', function () { navigateMonth(1); });

calTodayBtn.addEventListener('click', function () {
  var now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  selectedCalDate = formatDateISO(now);
  renderCalendar();
});

// Swipe gestures with vertical threshold
calGrid.addEventListener('touchstart', function (e) {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

calGrid.addEventListener('touchend', function (e) {
  var deltaX = touchStartX - e.changedTouches[0].screenX;
  var deltaY = touchStartY - e.changedTouches[0].screenY;
  if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
    navigateMonth(deltaX > 0 ? 1 : -1);
  }
}, { passive: true });

// Event delegation for calendar days
calDays.addEventListener('click', function (e) {
  var day = e.target.closest('.cal-day:not(.empty)');
  if (day) selectCalDay(day);
});
calDays.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') {
    var day = e.target.closest('.cal-day:not(.empty)');
    if (day) { e.preventDefault(); selectCalDay(day); }
  }
});

// Event delegation for cal day events
calDayEvents.addEventListener('click', function (e) {
  var card = e.target.closest('.event-card');
  if (card) openEditModal(card.dataset.id);
});
calDayEvents.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') {
    var card = e.target.closest('.event-card');
    if (card) { e.preventDefault(); openEditModal(card.dataset.id); }
  }
});

function renderCalendar() {
  var monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  calMonthLabel.textContent = monthNames[calMonth] + ' ' + calYear;

  var now = new Date();
  var isCurrentMonth = calYear === now.getFullYear() && calMonth === now.getMonth();
  calTodayBtn.classList.toggle('hidden', isCurrentMonth);

  var firstDay = new Date(calYear, calMonth, 1).getDay();
  var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  var todayStr = formatDateISO(now);

  var eventMap = {};
  var eventCountMap = {};
  var streakMap = {};
  var monthPrefix = calYear + '-' + String(calMonth + 1).padStart(2, '0');

  allEvents.forEach(function (ev) {
    var start = ev.date;
    var end = ev.endDate || ev.date;
    var person = (ev.person || 'Both').toLowerCase();
    var isMultiDay = end !== start;

    forEachDayInRange(start, end, function (key) {
      if (key.startsWith(monthPrefix)) {
        if (!eventMap[key]) eventMap[key] = new Set();
        eventMap[key].add(person);
        eventCountMap[key] = (eventCountMap[key] || 0) + 1;

        if (isMultiDay) {
          if (!streakMap[key]) streakMap[key] = { start: false, end: false, mid: false };
          if (key === start) streakMap[key].start = true;
          else if (key === end) streakMap[key].end = true;
          else streakMap[key].mid = true;
        }
      }
    });
  });

  var html = '';

  for (var i = 0; i < firstDay; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var isToday = dateStr === todayStr;
    var isSelected = dateStr === selectedCalDate;
    var persons = eventMap[dateStr];

    var personClass = '';
    if (persons) {
      var arr = Array.from(persons);
      if (arr.length > 1) personClass = ' cal-both';
      else if (arr.includes('both')) personClass = ' cal-both';
      else if (arr.includes('cody')) personClass = ' cal-cody';
      else if (arr.includes('stef')) personClass = ' cal-stef';
      else if (arr.includes('dogs')) personClass = ' cal-dogs';
    }

    var count = eventCountMap[dateStr] || 0;
    var intensityClass = '';
    if (count === 2) intensityClass = ' cal-intensity-2';
    else if (count >= 3) intensityClass = ' cal-intensity-3';

    var tallyHtml = '';
    if (count > 1) {
      var dots = Math.min(count, 5);
      tallyHtml = '<div class="cal-tally">';
      for (var t = 0; t < dots; t++) tallyHtml += '<span class="cal-tally-dot"></span>';
      tallyHtml += '</div>';
    }

    var isPayday = isPayDay(dateStr);

    var streakClass = '';
    var streak = streakMap[dateStr];
    if (streak) {
      var dayOfWeek = new Date(calYear, calMonth, d).getDay();
      var flatLeft = (streak.mid || streak.end) && dayOfWeek !== 0;
      var flatRight = (streak.mid || streak.start) && dayOfWeek !== 6;
      if (flatLeft && flatRight) streakClass = ' streak-mid';
      else if (flatLeft) streakClass = ' streak-end';
      else if (flatRight) streakClass = ' streak-start';
    }

    html += '<div class="cal-day' + (isToday ? ' today' : '') + (isSelected ? ' selected' : '') + personClass + intensityClass + streakClass + '" data-date="' + dateStr + '" tabindex="0" role="button" aria-label="' + dateStr + '">' +
      '<span class="cal-day-num">' + d + '</span>' +
      (isPayday ? '<span class="cal-payday">$</span>' : '') +
      tallyHtml +
    '</div>';
  }

  calDays.innerHTML = html;

  if (selectedCalDate) {
    renderCalDayEvents(selectedCalDate);
  } else {
    calDayEvents.innerHTML = '<p class="empty-state small">Tap a day to see events</p>';
  }
}

function selectCalDay(day) {
  selectedCalDate = day.dataset.date;
  calDays.querySelectorAll('.cal-day').forEach(function (d) { d.classList.remove('selected'); });
  day.classList.add('selected');
  renderCalDayEvents(selectedCalDate);
}

function renderCalDayEvents(dateStr) {
  var dayEvents = allEvents.filter(function (ev) {
    return ev.date <= dateStr && (ev.endDate || ev.date) >= dateStr;
  });

  if (dayEvents.length === 0) {
    calDayEvents.innerHTML = '<p class="empty-state small">No events on ' + formatShortDate(dateStr) + '</p>';
    return;
  }

  var todayStr = formatDateISO(new Date());
  var html = '<div class="cal-events-header">' + formatDateLabel(dateStr) + '</div>';
  dayEvents.forEach(function (ev) { html += buildEventCard(ev, todayStr); });
  calDayEvents.innerHTML = html;
}

// ---- Modal ----

addBtn.addEventListener('click', function () {
  modalTitle.textContent = 'New Event';
  eventForm.reset();
  document.getElementById('event-id').value = '';
  var defaultDate = selectedCalDate && !calendarView.classList.contains('hidden')
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

cancelBtn.addEventListener('click', function () { closeModal(eventModal); });
eventModal.querySelector('.modal-backdrop').addEventListener('click', function () { closeModal(eventModal); });

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (!deleteConfirm.classList.contains('hidden')) closeModal(deleteConfirm);
    else if (!eventModal.classList.contains('hidden')) closeModal(eventModal);
  }
});

function openModal(modal) {
  modal.classList.remove('hidden');
  modal.classList.add('modal-open');
  addBtn.classList.add('fab-rotate');
}

function closeModal(modal) {
  modal.classList.add('modal-closing');
  var content = modal.querySelector('.modal-content');
  function onEnd() {
    content.removeEventListener('animationend', onEnd);
    modal.classList.add('hidden');
    modal.classList.remove('modal-open', 'modal-closing');
    if (eventModal.classList.contains('hidden')) {
      addBtn.classList.remove('fab-rotate');
    }
  }
  content.addEventListener('animationend', onEnd);
  // Fallback in case animationend doesn't fire
  setTimeout(onEnd, 250);
}

function openEditModal(eventId) {
  var ev = allEvents.find(function (e) { return e.id === eventId; });
  if (!ev) return;

  modalTitle.textContent = 'Edit Event';
  document.getElementById('event-id').value = ev.id;
  document.getElementById('event-name').value = ev.name;
  eventDate.value = ev.date;
  eventEndDate.value = ev.endDate || '';
  eventEndDate.min = ev.date;
  eventTime.value = ev.time || '';
  eventAllDay.checked = ev.allDay || false;
  eventTime.classList.toggle('disabled-time', !!ev.allDay);
  document.getElementById('event-notes').value = ev.notes || '';

  var personValue = ev.person || 'Both';
  var radio = document.querySelector('input[name="event-person"][value="' + personValue + '"]');
  if (radio) radio.checked = true;

  deleteBtn.classList.remove('hidden');
  openModal(eventModal);
}

eventForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  if (saving) return;
  saving = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  var id = document.getElementById('event-id').value;
  var personRadio = document.querySelector('input[name="event-person"]:checked');

  var data = {
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
  } finally {
    saving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
});

// Custom delete confirmation
deleteBtn.addEventListener('click', function () { openModal(deleteConfirm); });
document.getElementById('confirm-cancel').addEventListener('click', function () { closeModal(deleteConfirm); });

document.getElementById('confirm-delete').addEventListener('click', async function () {
  var id = document.getElementById('event-id').value;
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

deleteConfirm.querySelector('.modal-backdrop').addEventListener('click', function () { closeModal(deleteConfirm); });

// ---- Start ----
listenToEvents();

})();
