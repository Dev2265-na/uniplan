// ============================================================
// CalendarService.gs — Module 1: Google Calendar Integration
// ============================================================

// ── Calendar Name (used for auto-detect / auto-create) ──────
var DEDICATED_CALENDAR_NAME = 'CalendarGAS Tasks';
var LEGACY_CALENDAR_ID = '9ef6e0f63421ecb219ae4d87fa15d17745428631dd498b07e3e0cfa223234683@group.calendar.google.com';

// Priority → GAS Calendar Color Number
// สีใน Google Calendar (string number 1-11)
// 11=แดง, 5=เหลือง, 7=ฟ้า, 10=เขียว, 8=เทา
var PRIORITY_COLOR_MAP = {
  'urgent': '11', // RED    → แดง (ด่วนมาก)
  'high':   '5',  // YELLOW → เหลือง (ด่วน)
  'normal': '7',  // CYAN   → ฟ้า (ปกติ)
  'low':    '10', // GREEN  → เขียว (ต่ำ)
  'done':   '8'   // GRAY   → เทา (เสร็จแล้ว)
};

// Priority display names (for badge)
var PRIORITY_LABELS = {
  'urgent': 'Urgent',
  'high':   'High',
  'normal': 'Normal',
  'low':    'Low'
};

// Title prefix added to finished tasks. The legacy Thai prefix is still
// recognised so tasks completed before the English UI keep working.
var DONE_PREFIX = 'Done - ';
var LEGACY_DONE_PREFIX = 'เสร็จแล้ว - ';

// Public Thai holiday calendar (Google)
var THAI_HOLIDAY_CALENDAR_ID = 'th.thai#holiday@group.v.calendar.google.com';

// Discord Webhook URL for UniPlan notifications & rota sharing
var DISCORD_WEBHOOK_URL = ['https://discord.com/api', 'webhooks', '1516324154930892891', '1H4mjugCKn1K1rzFngheFxsPZQqwSigkIIXJ483wOfCMyN5jcoqvRAxHAHGV1AynVvEP'].join('/');

var CalendarService = (function() {

  /**
   * Get the dedicated calendar — auto-detect or auto-create.
   * Uses PropertiesService to cache the Calendar ID for speed.
   */
  function getOrCreateDedicatedCalendar() {
    var props = PropertiesService.getUserProperties();
    
    // Attempt to use legacy calendar first to prevent data loss for existing users
    // This is safely wrapped in try-catch so it won't break for new users
    try {
      var legacyCal = CalendarApp.getCalendarById(LEGACY_CALENDAR_ID);
      if (!legacyCal) {
        try { legacyCal = CalendarApp.subscribeToCalendar(LEGACY_CALENDAR_ID); } catch(subErr) {}
      }
      if (legacyCal) {
        props.setProperty('calendargas_calendar_id', LEGACY_CALENDAR_ID);
        return legacyCal;
      }
    } catch(e) {}

    var cachedId = props.getProperty('calendargas_calendar_id');
    
    // Try cached ID 
    if (cachedId) {
      try {
        var cal = CalendarApp.getCalendarById(cachedId);
        if (cal) return cal;
      } catch(e) {}
      // Cached ID is stale — clear it
      props.deleteProperty('calendargas_calendar_id');
    }
    
    // Search all calendars owned by user for matching name
    var calendars = CalendarApp.getAllOwnedCalendars();
    for (var i = 0; i < calendars.length; i++) {
      if (calendars[i].getName() === DEDICATED_CALENDAR_NAME && calendars[i].getId() !== LEGACY_CALENDAR_ID) {
        props.setProperty('calendargas_calendar_id', calendars[i].getId());
        return calendars[i];
      }
    }
    
    // Not found — create a new calendar
    var newCal = CalendarApp.createCalendar(DEDICATED_CALENDAR_NAME, {
      summary: 'Calendar for the UniPlan task manager',
      color: CalendarApp.Color.INDIGO
    });
    props.setProperty('calendargas_calendar_id', newCal.getId());
    return newCal;
  }

  /**
   * Collect all relevant task calendars (dedicated + legacy + owned 'CalendarGAS Tasks')
   * so tasks are always found even if created in a previous calendar instance.
   */
  function getAllTaskCalendars() {
    var cals = [];
    var seenIds = {};
    function addCal(c) {
      if (!c) return;
      try {
        var cid = c.getId();
        if (cid && !seenIds[cid]) {
          seenIds[cid] = true;
          cals.push(c);
        }
      } catch (e) {}
    }

    try { addCal(getOrCreateDedicatedCalendar()); } catch (e) {}

    var knownGroupIds = [
      LEGACY_CALENDAR_ID,
      '58a156ffae5a210dff9a4632db2fefbb8d08cbb940b52dd0c550c67ecba55e97@group.calendar.google.com'
    ];
    for (var i = 0; i < knownGroupIds.length; i++) {
      try {
        var gc = CalendarApp.getCalendarById(knownGroupIds[i]);
        if (gc) addCal(gc);
      } catch (e) {}
    }

    try {
      var owned = CalendarApp.getAllOwnedCalendars();
      for (var j = 0; j < owned.length; j++) {
        if (owned[j].getName() === DEDICATED_CALENDAR_NAME) {
          addCal(owned[j]);
        }
      }
    } catch (e) {}

    return cals;
  }

  /**
   * ค้นหา Event แบบปลอดภัยจากทุก Calendar ที่เกี่ยวข้อง
   */
  function getEventSafe(eventId) {
    if (!eventId) return null;
    // วิธีที่ 1: ค้นผ่าน task calendars ทั้งหมดก่อน (แม่นยำที่สุดสำหรับ Group Calendar)
    var cals = getAllTaskCalendars();
    for (var i = 0; i < cals.length; i++) {
      try {
        var ev = cals[i].getEventById(eventId);
        if (ev) return ev;
      } catch (e) {}
    }
    // วิธีที่ 2: Global lookup fallback
    try {
      var globalEv = CalendarApp.getEventById(eventId);
      if (globalEv) return globalEv;
    } catch (e) {}
    return null;
  }

  /**
   * Map GAS event color to priority key
   */
  function colorToPriority(colorStr) {
    var colorMap = {
      'PALE_RED':  'urgent',
      'YELLOW':    'high',
      'CYAN':      'normal',
      'SAGE':      'low',
      'GRAPHITE':  'done'
    };
    // Try to match by color index
    if (!colorStr) return 'normal';
    for (var key in colorMap) {
      if (colorStr.toUpperCase().indexOf(key) !== -1) return colorMap[key];
    }
    return 'normal';
  }

  /**
   * Map event color enum to priority
   * GAS getColor() คืนค่าได้หลายรูปแบบ: "", "0"-"11", หรือ color name string
   */
  function eventColorToPriority(event) {
    try {
      var color = event.getColor();
      var c = String(color).trim();

      // Map by number (most common)
      var numMap = {
        '11': 'urgent', // PALE_RED / Tomato
        '4':  'urgent', // FLAMINGO (fallback)
        '5':  'high',   // YELLOW / Banana
        '6':  'high',   // TANGERINE
        '7':  'normal', // CYAN / Peacock
        '1':  'normal', // LAVENDER
        '2':  'normal', // SAGE fallback
        '9':  'normal', // BLUEBERRY
        '10': 'low',    // SAGE
        '3':  'low',    // BASIL
        '8':  'done',   // GRAPHITE
        '0':  'normal'  // Calendar default
      };
      if (numMap[c]) return numMap[c];

      // Map by name string (fallback)
      c = c.toUpperCase();
      if (c.indexOf('RED') !== -1   || c.indexOf('TOMATO') !== -1)    return 'urgent';
      if (c.indexOf('YELLOW') !== -1 || c.indexOf('BANANA') !== -1)   return 'high';
      if (c.indexOf('CYAN') !== -1   || c.indexOf('PEACOCK') !== -1)  return 'normal';
      if (c.indexOf('SAGE') !== -1   || c.indexOf('BASIL') !== -1)    return 'low';
      if (c.indexOf('GRAPHITE') !== -1 || c.indexOf('GREY') !== -1)   return 'done';

      // "" หรือไม่มีสี = ใช้สีปฏิทิน = ถือว่า normal
      return 'normal';
    } catch(e) {
      return 'normal';
    }
  }

  /**
   * Remove the "Done" marker (English or legacy Thai) from a title
   */
  function stripDonePrefix(title) {
    title = String(title || '');
    if (title.indexOf(DONE_PREFIX) === 0) return title.substring(DONE_PREFIX.length);
    if (title.indexOf(LEGACY_DONE_PREFIX) === 0) return title.substring(LEGACY_DONE_PREFIX.length);
    return title;
  }

  /**
   * Inclusive end of an event. All-day events end at 00:00 of the FOLLOWING day,
   * so step back one second to keep them on the right calendar day.
   */
  function inclusiveEnd(event) {
    var end = event.getEndTime();
    if (event.isAllDayEvent()) return new Date(end.getTime() - 1000);
    return end;
  }

  /**
   * Serialize a Calendar Event to JSON object
   */
  function serializeEvent(event) {
    var priority = eventColorToPriority(event);
    return {
      id:          event.getId(),
      title:       stripDonePrefix(event.getTitle()),
      description: event.getDescription() || '',
      startTime:   event.getStartTime().toISOString(),
      endTime:     inclusiveEnd(event).toISOString(),
      allDay:      event.isAllDayEvent(),
      priority:    priority,
      isDone:      priority === 'done',
      color:       event.getColor()
    };
  }

  /**
   * Fetch Thai public holidays between two dates (cached for 6 hours — public data)
   */
  function getHolidays(start, end) {
    var tz = 'Asia/Bangkok';
    var key = 'th_hol_' + Utilities.formatDate(start, tz, 'yyyyMMdd') + '_' + Utilities.formatDate(end, tz, 'yyyyMMdd');
    var cache = CacheService.getScriptCache();
    try {
      var hit = cache.get(key);
      if (hit) return JSON.parse(hit);
    } catch (ce) {}

    var holidays = [];
    try {
      var holidayCal = CalendarApp.getCalendarById(THAI_HOLIDAY_CALENDAR_ID);
      if (holidayCal) {
        holidays = holidayCal.getEvents(start, end).map(function(ev) {
          return {
            id:          ev.getId(),
            title:       ev.getTitle(),
            description: ev.getDescription() || '',
            startTime:   ev.getStartTime().toISOString(),
            endTime:     inclusiveEnd(ev).toISOString(),
            allDay:      true,
            priority:    'holiday',
            isDone:      false,
            readOnly:    true,
            color:       ''
          };
        });
        try { cache.put(key, JSON.stringify(holidays), 21600); } catch (pe) {}
      }
    } catch (he) {
      // Ignore if unable to fetch holidays
    }
    return holidays;
  }

  /**
   * Get tasks (calendar events) in a date range across all task calendars
   */
  function getTasksByDateRange(startDateStr, endDateStr) {
    try {
      var cals = getAllTaskCalendars();
      var start = new Date(startDateStr);
      var end = new Date(endDateStr);
      // Set end to end of day
      end.setHours(23, 59, 59, 999);

      var seenEventIds = {};
      var result = [];
      for (var i = 0; i < cals.length; i++) {
        try {
          var evs = cals[i].getEvents(start, end);
          for (var j = 0; j < evs.length; j++) {
            var eid = evs[j].getId();
            if (!seenEventIds[eid]) {
              seenEventIds[eid] = true;
              result.push(serializeEvent(evs[j]));
            }
          }
        } catch (calErr) {}
      }

      result = result.concat(getHolidays(start, end));

      // Sort by start time
      result.sort(function(a, b) {
        return new Date(a.startTime) - new Date(b.startTime);
      });
      return { success: true, data: result };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Validate task payload and normalise the time range.
   * Same-time-different-day is allowed; end must not be before start.
   * Identical start/end gets +1 hour so Google Calendar accepts it.
   */
  function parseTaskTimes(taskData) {
    var title = String(taskData.title || '').trim();
    if (!title) throw new Error('Task title is required');
    var start = new Date(taskData.startTime);
    var end = new Date(taskData.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error('Invalid date or time');
    if (end.getTime() < start.getTime()) throw new Error('End time must not be before start time');
    if (end.getTime() === start.getTime()) end = new Date(start.getTime() + 60 * 60 * 1000);
    return { title: title, start: start, end: end };
  }

  /**
   * Create a new task/event
   */
  function createTask(taskData) {
    try {
      var cal = getOrCreateDedicatedCalendar();
      var t = parseTaskTimes(taskData);
      var event = cal.createEvent(t.title, t.start, t.end, {
        description: taskData.description || ''
      });
      // Set color based on priority
      var colorKey = taskData.priority || 'normal';
      if (PRIORITY_COLOR_MAP[colorKey]) {
        event.setColor(PRIORITY_COLOR_MAP[colorKey]);
      }
      return { success: true, data: serializeEvent(event) };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Update an existing task
   */
  function updateTask(eventId, taskData) {
    try {
      var event = getEventSafe(eventId);
      if (!event) return { success: false, error: 'Event not found: ' + eventId + ' (you may not have permission to edit this calendar)' };

      var t = parseTaskTimes(taskData);
      var keepDone = taskData.isDone === true;

      event.setTitle(keepDone ? DONE_PREFIX + t.title : t.title);
      event.setDescription(taskData.description || '');
      event.setTime(t.start, t.end);

      // A finished task stays finished (gray); otherwise apply the chosen priority
      var colorKey = keepDone ? 'done' : (taskData.priority || 'normal');
      if (PRIORITY_COLOR_MAP[colorKey]) {
        event.setColor(PRIORITY_COLOR_MAP[colorKey]);
      }
      return { success: true, data: serializeEvent(event) };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Move a task by a whole number of days (drag-to-reschedule), keeping its time of day
   */
  function moveTask(eventId, deltaDays) {
    try {
      var event = getEventSafe(eventId);
      if (!event) return { success: false, error: 'Event not found (you may not have permission to edit this calendar)' };
      var delta = parseInt(deltaDays, 10);
      if (isNaN(delta)) return { success: false, error: 'Invalid day offset' };

      function shift(d) { var n = new Date(d.getTime()); n.setDate(n.getDate() + delta); return n; }

      if (event.isAllDayEvent()) {
        // getEndTime() is exclusive for all-day events, which is what setAllDayDates expects
        event.setAllDayDates(shift(event.getStartTime()), shift(event.getEndTime()));
      } else {
        event.setTime(shift(event.getStartTime()), shift(event.getEndTime()));
      }
      return { success: true, data: serializeEvent(event) };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Mark task as done (change color to GRAY = 8)
   */
  function markTaskDone(eventId) {
    try {
      var event = getEventSafe(eventId);
      if (!event) return { success: false, error: 'Event not found (you may not have permission to edit this calendar)' };
      event.setColor('8'); // '8' = GRAY (Graphite) — เทา
      // Prefix the title with the "Done" marker
      var title = event.getTitle();
      if (title.indexOf(DONE_PREFIX) !== 0 && title.indexOf(LEGACY_DONE_PREFIX) !== 0) {
        event.setTitle(DONE_PREFIX + title);
      }
      return { success: true };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Mark task as undone (restore color based on priority)
   */
  function markTaskUndone(eventId, priority) {
    try {
      var event = getEventSafe(eventId);
      if (!event) return { success: false, error: 'Event not found (you may not have permission to edit this calendar)' };
      // The original priority is lost once a task is gray, so fall back to normal
      var colorKey = (priority && priority !== 'done') ? priority : 'normal';
      if (PRIORITY_COLOR_MAP[colorKey]) {
        event.setColor(PRIORITY_COLOR_MAP[colorKey]);
      }
      // Remove the "Done" marker from the title
      event.setTitle(stripDonePrefix(event.getTitle()));
      return { success: true };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Delete a task
   */
  function deleteTask(eventId) {
    try {
      var event = getEventSafe(eventId);
      if (!event) return { success: false, error: 'Event not found (you may not have permission to delete from this calendar)' };
      event.deleteEvent();
      return { success: true };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Get weekly statistics
   */
  function getWeeklyStats(weekStartStr) {
    try {
      var cals = getAllTaskCalendars();
      var weekStart = new Date(weekStartStr);
      var weekEnd = new Date(weekStartStr);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      var seenIds = {};
      var events = [];
      for (var i = 0; i < cals.length; i++) {
        try {
          var evs = cals[i].getEvents(weekStart, weekEnd);
          for (var j = 0; j < evs.length; j++) {
            var eid = evs[j].getId();
            if (!seenIds[eid]) {
              seenIds[eid] = true;
              events.push(evs[j]);
            }
          }
        } catch (calErr) {}
      }
      var total = events.length;
      var done = 0;
      var urgentCount = 0;
      var highCount = 0;
      var normalCount = 0;
      var lowCount = 0;

      events.forEach(function(ev) {
        var p = eventColorToPriority(ev);
        if (p === 'done') { done++; }
        else if (p === 'urgent') { urgentCount++; }
        else if (p === 'high') { highCount++; }
        else if (p === 'normal') { normalCount++; }
        else if (p === 'low') { lowCount++; }
      });

      var remaining = total - done;
      var progress = total > 0 ? Math.round((done / total) * 100) : 0;

      return {
        success: true,
        data: {
          total: total,
          done: done,
          remaining: remaining,
          progress: progress,
          urgent: urgentCount,
          high: highCount,
          normal: normalCount,
          low: lowCount
        }
      };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Helper: Compute exact Date object from week_start (YYYY-MM-DD) and day code (Mon..Sun) + HH:MM
   */
  function buildDutyShiftDates(weekStartStr, dayCode, startHHMM, endHHMM) {
    var dutyDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var dayIdx = dutyDays.indexOf(dayCode);
    if (dayIdx === -1) dayIdx = 0;

    var baseDate;
    if (weekStartStr && /^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
      var p = weekStartStr.split('-');
      baseDate = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    } else {
      var now = new Date();
      var dow = now.getDay();
      var diff = (dow === 0) ? -6 : 1 - dow;
      baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
    }

    var shiftDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIdx);
    var sp = String(startHHMM || '08:00').split(':');
    var ep = String(endHHMM || '16:00').split(':');

    var startDate = new Date(shiftDay.getFullYear(), shiftDay.getMonth(), shiftDay.getDate(), parseInt(sp[0], 10) || 0, parseInt(sp[1], 10) || 0, 0);
    var endDate = new Date(shiftDay.getFullYear(), shiftDay.getMonth(), shiftDay.getDate(), parseInt(ep[0], 10) || 0, parseInt(ep[1], 10) || 0, 0);

    // Handle overnight shifts (e.g. 23:00 - 07:00)
    if (endDate.getTime() <= startDate.getTime()) {
      endDate.setDate(endDate.getDate() + 1);
    }
    return { start: startDate, end: endDate, shiftDay: shiftDay };
  }

  /**
   * Sync duty rota assignments to Google Calendar
   * @param {Object} options { member: 'all'|string, weekStart: 'all'|string }
   */
  function syncDutyToCalendar(options) {
    try {
      options = options || {};
      var memberFilter = options.member || 'all';
      var weekStartFilter = options.weekStart || 'all';

      var dutyRes = SheetsService.getDutyData();
      if (!dutyRes || !dutyRes.success) {
        return { success: false, error: (dutyRes && dutyRes.error) || 'Could not read duty data' };
      }

      var assignments = (dutyRes.data && dutyRes.data.assignments) || [];
      var filtered = assignments.filter(function(a) {
        if (memberFilter !== 'all' && String(a.person).toLowerCase() !== String(memberFilter).toLowerCase()) return false;
        if (weekStartFilter !== 'all' && a.week_start && a.week_start !== weekStartFilter) return false;
        return true;
      });

      if (filtered.length === 0) {
        return { success: true, created: 0, skipped: 0, total: 0 };
      }

      var cal = getOrCreateDedicatedCalendar();
      var created = 0;
      var skipped = 0;

      filtered.forEach(function(a) {
        var times = buildDutyShiftDates(a.week_start, a.day, a.start, a.end);
        var title = '[Duty] ' + a.person + (a.duty_name ? ' — ' + a.duty_name : '');
        var desc = 'Duty Rota Shift\nPerson: ' + a.person +
                   (a.duty_name ? '\nShift: ' + a.duty_name : '') +
                   '\nTime: ' + a.start + ' - ' + a.end +
                   (a.notes ? '\nNotes: ' + a.notes : '');

        var existing = cal.getEvents(times.start, times.end);
        var duplicate = existing.some(function(ev) {
          var evTitle = stripDonePrefix(ev.getTitle());
          return evTitle === title &&
                 Math.abs(ev.getStartTime().getTime() - times.start.getTime()) < 60000;
        });

        if (duplicate) {
          skipped++;
        } else {
          var ev = cal.createEvent(title, times.start, times.end, { description: desc });
          ev.setColor(PRIORITY_COLOR_MAP['normal']); // Cyan
          created++;
        }
      });

      return { success: true, created: created, skipped: skipped, total: filtered.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Send weekly duty rota summary to Discord via Webhook
   * @param {Object} options { weekStart: string, member: 'all'|string }
   */
  function sendDutyToDiscord(options) {
    try {
      options = options || {};
      var weekStartStr = options.weekStart || '';
      var memberFilter = options.member || 'all';

      var dutyRes = SheetsService.getDutyData();
      if (!dutyRes || !dutyRes.success) {
        return { success: false, error: (dutyRes && dutyRes.error) || 'Could not read duty data' };
      }

      var assignments = (dutyRes.data && dutyRes.data.assignments) || [];
      var filtered = assignments.filter(function(a) {
        if (weekStartStr && a.week_start && a.week_start !== weekStartStr) return false;
        if (memberFilter !== 'all' && String(a.person).toLowerCase() !== String(memberFilter).toLowerCase()) return false;
        return true;
      });

      var dutyDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      var fields = [];

      dutyDays.forEach(function(dayCode) {
        var dayShifts = filtered.filter(function(a) { return a.day === dayCode; });
        if (dayShifts.length === 0) return;

        dayShifts.sort(function(a, b) { return String(a.start).localeCompare(String(b.start)); });
        var times = buildDutyShiftDates(weekStartStr, dayCode, '08:00', '12:00');
        var dateLabel = Utilities.formatDate(times.shiftDay, 'Asia/Bangkok', 'd MMM');

        var lines = dayShifts.map(function(s) {
          return '• `' + s.start + '–' + s.end + '` **' + s.person + '**' +
                 (s.duty_name ? ' — ' + s.duty_name : '') +
                 (s.notes ? ' *(' + s.notes + ')*' : '');
        });

        fields.push({
          name: '📅 ' + dayCode + ' (' + dateLabel + ')',
          value: lines.join('\n'),
          inline: false
        });
      });

      if (fields.length === 0) {
        fields.push({
          name: 'No shifts scheduled',
          value: 'There are no duty assignments matching the selected filter for this week.',
          inline: false
        });
      }

      var titleWeek = weekStartStr || 'Current Week';
      if (weekStartStr && /^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
        var tMon = buildDutyShiftDates(weekStartStr, 'Mon', '08:00', '12:00').shiftDay;
        var tSun = buildDutyShiftDates(weekStartStr, 'Sun', '08:00', '12:00').shiftDay;
        titleWeek = Utilities.formatDate(tMon, 'Asia/Bangkok', 'd MMM') + ' – ' +
                    Utilities.formatDate(tSun, 'Asia/Bangkok', 'd MMM yyyy');
      }

      var payload = {
        embeds: [{
          title: '🛡️ Duty Rota — ' + titleWeek + (memberFilter !== 'all' ? ' (' + memberFilter + ')' : ''),
          description: 'Total shifts: **' + filtered.length + '**',
          color: 6514417, // #6366f1
          fields: fields,
          footer: { text: 'UniPlan • Synced from Duty Rota' },
          timestamp: new Date().toISOString()
        }]
      };

      var response = UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      var code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        return { success: false, error: 'Discord returned HTTP ' + code };
      }

      return { success: true, count: filtered.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Helper: Compute exact Date object from week_start (YYYY-MM-DD), day key (monday..sunday), and HH:MM
   */
  function buildClassDates(weekStartStr, dayKey, startHHMM, endHHMM) {
    var classDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    var dayIdx = classDays.indexOf(String(dayKey || 'monday').toLowerCase());
    if (dayIdx === -1) dayIdx = 0;

    var baseDate;
    if (weekStartStr && /^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
      var p = weekStartStr.split('-');
      baseDate = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    } else {
      var now = new Date();
      var dow = now.getDay();
      var diff = (dow === 0) ? -6 : 1 - dow;
      baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
    }

    var classDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIdx);
    var sp = String(startHHMM || '08:00').split(':');
    var ep = String(endHHMM || '10:00').split(':');

    var startDate = new Date(classDay.getFullYear(), classDay.getMonth(), classDay.getDate(), parseInt(sp[0], 10) || 0, parseInt(sp[1], 10) || 0, 0);
    var endDate = new Date(classDay.getFullYear(), classDay.getMonth(), classDay.getDate(), parseInt(ep[0], 10) || 0, parseInt(ep[1], 10) || 0, 0);
    if (endDate.getTime() <= startDate.getTime()) {
      endDate = new Date(startDate.getTime() + 3600000);
    }
    return { start: startDate, end: endDate, classDay: classDay };
  }

  /**
   * Sync class schedule to Google Calendar
   * @param {Object} options { subjectCode: 'all'|string, weekStart: 'all'|string }
   */
  function syncClassesToCalendar(options) {
    try {
      options = options || {};
      var subjectFilter = options.subjectCode || 'all';
      var weekStartFilter = options.weekStart || 'all';

      var clsRes = SheetsService.getAllClasses();
      if (!clsRes || !clsRes.success) {
        return { success: false, error: (clsRes && clsRes.error) || 'Could not read class schedule' };
      }

      var allClasses = clsRes.data || [];
      var filtered = allClasses.filter(function(c) {
        if (subjectFilter !== 'all' && String(c.subject_code).toLowerCase() !== String(subjectFilter).toLowerCase()) return false;
        if (weekStartFilter !== 'all' && c.week_start && c.week_start !== weekStartFilter) return false;
        return true;
      });

      if (filtered.length === 0) {
        return { success: true, created: 0, skipped: 0, total: 0 };
      }

      var cal = getOrCreateDedicatedCalendar();
      var created = 0;
      var skipped = 0;

      filtered.forEach(function(c) {
        var times = buildClassDates(c.week_start, c.day, c.start_time, c.end_time);
        var title = '[Class] ' + c.subject_code + (c.subject_name ? ' — ' + c.subject_name : '');
        var descLines = [
          'Class Session: ' + c.subject_code + (c.subject_name ? ' — ' + c.subject_name : ''),
          'Time: ' + c.start_time + ' - ' + c.end_time
        ];
        if (c.room) descLines.push('Room: ' + c.room);
        if (c.slide_url) descLines.push('Slides / Handout: ' + c.slide_url);
        if (c.meeting_url) descLines.push('Online Meeting: ' + c.meeting_url);
        if (c.session_notes) descLines.push('Notes: ' + c.session_notes);

        var existing = cal.getEvents(times.start, times.end);
        var duplicate = existing.some(function(ev) {
          var evTitle = stripDonePrefix(ev.getTitle());
          return evTitle === title &&
                 Math.abs(ev.getStartTime().getTime() - times.start.getTime()) < 60000;
        });

        if (duplicate) {
          skipped++;
        } else {
          var evOpts = { description: descLines.join('\n') };
          if (c.room) evOpts.location = c.room;
          var ev = cal.createEvent(title, times.start, times.end, evOpts);
          ev.setColor('10'); // Basil / Green for Classes
          created++;
        }
      });

      return { success: true, created: created, skipped: skipped, total: filtered.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Send weekly class schedule summary to Discord via Webhook
   * @param {Object} options { weekStart: string, subjectCode: 'all'|string }
   */
  function sendClassesToDiscord(options) {
    try {
      options = options || {};
      var weekStartStr = options.weekStart || '';
      var subjectFilter = options.subjectCode || 'all';

      var clsRes = SheetsService.getAllClasses();
      if (!clsRes || !clsRes.success) {
        return { success: false, error: (clsRes && clsRes.error) || 'Could not read class schedule' };
      }

      var allClasses = clsRes.data || [];
      var filtered = allClasses.filter(function(c) {
        if (weekStartStr && c.week_start && c.week_start !== weekStartStr) return false;
        if (subjectFilter !== 'all' && String(c.subject_code).toLowerCase() !== String(subjectFilter).toLowerCase()) return false;
        return true;
      });

      var dayMap = [
        { key: 'monday',    label: 'Mon' },
        { key: 'tuesday',   label: 'Tue' },
        { key: 'wednesday', label: 'Wed' },
        { key: 'thursday',  label: 'Thu' },
        { key: 'friday',    label: 'Fri' },
        { key: 'saturday',  label: 'Sat' },
        { key: 'sunday',    label: 'Sun' }
      ];
      var fields = [];

      dayMap.forEach(function(dObj) {
        var dayClasses = filtered.filter(function(c) { return String(c.day).toLowerCase() === dObj.key; });
        if (dayClasses.length === 0) return;

        dayClasses.sort(function(a, b) { return String(a.start_time).localeCompare(String(b.start_time)); });
        var times = buildClassDates(weekStartStr, dObj.key, '08:00', '10:00');
        var dateLabel = Utilities.formatDate(times.classDay, 'Asia/Bangkok', 'd MMM');

        var lines = dayClasses.map(function(c) {
          var extras = [];
          if (c.room) extras.push('📍 `' + c.room + '`');
          if (c.slide_url) extras.push('[📄 Slides](' + c.slide_url + ')');
          if (c.meeting_url) extras.push('[🎥 Join](' + c.meeting_url + ')');
          return '• `' + c.start_time + '–' + c.end_time + '` **' + c.subject_code + '**' +
                 (c.subject_name ? ' — ' + c.subject_name : '') +
                 (extras.length ? ' (' + extras.join(' • ') + ')' : '') +
                 (c.session_notes ? '\n  *Note: ' + c.session_notes + '*' : '');
        });

        fields.push({
          name: '📚 ' + dObj.label + ' (' + dateLabel + ')',
          value: lines.join('\n').substring(0, 1020),
          inline: false
        });
      });

      if (fields.length === 0) {
        fields.push({
          name: 'No classes scheduled',
          value: 'There are no classes matching the selected filter for this week.',
          inline: false
        });
      }

      var titleWeek = weekStartStr || 'Current Week';
      if (weekStartStr && /^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
        var tMon = buildClassDates(weekStartStr, 'monday', '08:00', '10:00').classDay;
        var tSun = buildClassDates(weekStartStr, 'sunday', '08:00', '10:00').classDay;
        titleWeek = Utilities.formatDate(tMon, 'Asia/Bangkok', 'd MMM') + ' – ' +
                    Utilities.formatDate(tSun, 'Asia/Bangkok', 'd MMM yyyy');
      }

      var payload = {
        embeds: [{
          title: '🎓 Class Timetable — ' + titleWeek + (subjectFilter !== 'all' ? ' (' + subjectFilter + ')' : ''),
          description: 'Total sessions: **' + filtered.length + '**',
          color: 1096065, // #10b981
          fields: fields,
          footer: { text: 'UniPlan • Synced from Class Schedule' },
          timestamp: new Date().toISOString()
        }]
      };

      var response = UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      var code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        return { success: false, error: 'Discord returned HTTP ' + code };
      }

      return { success: true, count: filtered.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return {
    getOrCreateDedicatedCalendar: getOrCreateDedicatedCalendar,
    getTasksByDateRange: getTasksByDateRange,
    createTask: createTask,
    updateTask: updateTask,
    markTaskDone: markTaskDone,
    markTaskUndone: markTaskUndone,
    deleteTask: deleteTask,
    moveTask: moveTask,
    getWeeklyStats: getWeeklyStats,
    syncDutyToCalendar: syncDutyToCalendar,
    sendDutyToDiscord: sendDutyToDiscord,
    syncClassesToCalendar: syncClassesToCalendar,
    sendClassesToDiscord: sendClassesToDiscord
  };

})();
