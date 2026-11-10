// ============================================================
// SheetsService.gs — Google Sheets Integration
//   Module: Class Schedule (Classes + SubjectPool sheets)
//   Module: Duty / Rota    (Duty + Duty_Members + Duty_Slots sheets)
// ============================================================

// NOTE: the spreadsheet name is kept as-is so existing users keep their data
var SPREADSHEET_NAME = 'ตารางเรียน GAS';
var SHEET_CLASSES    = 'Classes';
var SHEET_POOL       = 'SubjectPool';
var SHEET_DUTY       = 'Duty';
var SHEET_DUTY_MEMBERS = 'Duty_Members';
var SHEET_DUTY_SLOTS = 'Duty_Slots';

var SPREADSHEET_ID_PROP = 'uniplan_spreadsheet_id';

var CLASSES_HEADERS = ['id','subject_code','subject_name','week_start','day','start_time','end_time','room','color','slide_url','meeting_url','session_notes'];
var POOL_HEADERS    = ['id','subject_code','subject_name','room','color'];
var DUTY_HEADERS         = ['Date','Day','TimeSlotStart','TimeSlotEnd','DutyName','Person','Notes'];
var DUTY_MEMBER_HEADERS  = ['Name','Color'];
var DUTY_SLOT_HEADERS    = ['TimeSlotStart','TimeSlotEnd'];

var DUTY_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

var SheetsService = (function() {

  var spreadsheetCache = null; // per-execution cache

  // ── Spreadsheet / sheet helpers ───────────────────────────

  /**
   * Open a spreadsheet by id, or return null if it is gone / inaccessible
   */
  function tryOpenById(id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { return null; }
  }

  /**
   * Get or create the dedicated spreadsheet.
   * The id is cached per user; creation is serialised so parallel
   * requests on first load cannot create two spreadsheets.
   */
  function getOrCreateSpreadsheet() {
    if (spreadsheetCache) return spreadsheetCache;

    var props = PropertiesService.getUserProperties();
    var cachedId = props.getProperty(SPREADSHEET_ID_PROP);
    if (cachedId) {
      spreadsheetCache = tryOpenById(cachedId);
      if (spreadsheetCache) return spreadsheetCache;
      props.deleteProperty(SPREADSHEET_ID_PROP);
    }

    var lock = LockService.getUserLock();
    lock.waitLock(20000);
    try {
      // Another request may have finished creating it while we waited
      cachedId = props.getProperty(SPREADSHEET_ID_PROP);
      if (cachedId) {
        spreadsheetCache = tryOpenById(cachedId);
        if (spreadsheetCache) return spreadsheetCache;
      }

      // Search in Drive if permission allows
      try {
        var files = DriveApp.getFilesByName(SPREADSHEET_NAME);
        while (files.hasNext()) {
          var file = files.next();
          if (file.isTrashed()) continue;
          spreadsheetCache = SpreadsheetApp.open(file);
          props.setProperty(SPREADSHEET_ID_PROP, spreadsheetCache.getId());
          return spreadsheetCache;
        }
      } catch (driveErr) {
        // DriveApp not permitted or scope removed; proceed to create via SpreadsheetApp
      }

      // Create new spreadsheet
      var ss = SpreadsheetApp.create(SPREADSHEET_NAME);
      // Rename default sheet → Classes
      var sheet1 = ss.getSheets()[0];
      sheet1.setName(SHEET_CLASSES);
      writeHeader(sheet1, CLASSES_HEADERS);
      // Create SubjectPool sheet
      var sheet2 = ss.insertSheet(SHEET_POOL);
      writeHeader(sheet2, POOL_HEADERS);
      props.setProperty(SPREADSHEET_ID_PROP, ss.getId());
      spreadsheetCache = ss;
      return ss;
    } finally {
      lock.releaseLock();
    }
  }

  function writeHeader(sheet, headers) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#1e293b')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  /**
   * Get a sheet by name, creating it (with header row) when missing
   */
  function ensureSheet(name, headers) {
    var ss = getOrCreateSpreadsheet();
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      writeHeader(sheet, headers);
    } else {
      var lastCol = sheet.getLastColumn();
      if (lastCol > 0) {
        var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
        if (name === SHEET_CLASSES) {
          if (existingHeaders.indexOf('week_start') === -1 && existingHeaders.indexOf('date') === -1) {
            sheet.insertColumnBefore(4);
          }
          if (existingHeaders.length < headers.length) {
            writeHeader(sheet, headers);
          }
        } else if (name === SHEET_DUTY) {
          if (existingHeaders.indexOf('WeekStart') === -1 && existingHeaders.indexOf('Date') === -1) {
            sheet.insertColumnBefore(1);
          }
          // Always ensure the headers are current (updates 'WeekStart' -> 'Date')
          writeHeader(sheet, headers);
        }
      }
    }
    return sheet;
  }

  /**
   * Read all data rows (display values) of a sheet, skipping rows whose first cell is empty
   */
  function readRows(sheet, width, requireFirstCell) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();
    if (requireFirstCell === false) {
      return data.filter(function(r) { return r.some(function(c) { return c !== ''; }); });
    }
    return data.filter(function(r) { return r[0] !== ''; });
  }

  /**
   * Overwrite all data rows (header is kept). Cells are written as plain text so
   * user input such as "=1+1" is never evaluated as a formula.
   */
  function overwriteRows(sheet, width, rows) {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, width).clearContent();
    }
    if (rows.length === 0) return;
    var range = sheet.getRange(2, 1, rows.length, width);
    range.setNumberFormat('@');
    range.setValues(rows);
  }

  /**
   * Normalise any time-ish value ("9:00", "09:00:00", "9:05 AM") to "HH:MM" ('' when invalid)
   */
  function normalizeTime(value) {
    var m = String(value === null || value === undefined ? '' : value).trim()
      .match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
    if (!m) return '';
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (m[3]) { // 12-hour clock display
      var pm = m[3].toLowerCase() === 'pm';
      if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12;
    }
    if (h > 24 || min > 59) return '';
    return (h < 10 ? '0' : '') + h + ':' + m[2];
  }

  var DUTY_DAYS_LIST = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var CLASS_DAYS_LIST = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  /**
   * Safely parse multiple date representations (ISO, D/M/Y, M/D/Y, Buddhist Era, Date objects)
   */
  function parseDateSafe(val) {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) return val;
    var s = String(val).trim();
    if (!s) return null;
    var mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (mIso) {
      var y = parseInt(mIso[1], 10);
      if (y > 2400) y -= 543;
      return new Date(y, parseInt(mIso[2], 10) - 1, parseInt(mIso[3], 10));
    }
    var mSlash = s.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/);
    if (mSlash) {
      var d = parseInt(mSlash[1], 10);
      var m = parseInt(mSlash[2], 10);
      var y = parseInt(mSlash[3], 10);
      if (y < 100) y += 2000;
      if (y > 2400) y -= 543;
      return new Date(y, m - 1, d);
    }
    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) return parsed;
    return null;
  }

  /**
   * Return ISO YYYY-MM-DD for the Monday starting the week of date d
   */
  function getWeekStartISO(d) {
    if (!d) return '';
    var day = d.getDay(); // 0 = Sun
    var diff = (day === 0) ? -6 : 1 - day;
    var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
    var y = mon.getFullYear();
    var m = mon.getMonth() + 1;
    var dt = mon.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dt < 10 ? '0' : '') + dt;
  }

  /**
   * Normalize any week_start representation into standard YYYY-MM-DD
   */
  function normalizeWeekStart(value) {
    var d = parseDateSafe(value);
    if (d) return getWeekStartISO(d);
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return '';
  }

  function addDaysDate(d, n) {
    var r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  /**
   * Calculate exact shift date YYYY-MM-DD from week_start and 3-letter day
   */
  function getDutyAssignmentDate(weekStartStr, dayCode) {
    var d = parseDateSafe(weekStartStr);
    if (!d) return weekStartStr || '';
    var mon = parseDateSafe(getWeekStartISO(d));
    if (!mon) return weekStartStr || '';
    var dayIdx = DUTY_DAYS.indexOf(dayCode);
    if (dayIdx === -1) dayIdx = 0;
    var shiftDate = addDaysDate(mon, dayIdx);
    var y = shiftDate.getFullYear();
    var m = shiftDate.getMonth() + 1;
    var dt = shiftDate.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dt < 10 ? '0' : '') + dt;
  }

  var CLASS_WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  /**
   * Calculate exact class date YYYY-MM-DD from week_start and day name
   */
  function getClassDate(weekStartStr, dayCode) {
    var d = parseDateSafe(weekStartStr);
    if (!d) return weekStartStr || '';
    var mon = parseDateSafe(getWeekStartISO(d));
    if (!mon) return weekStartStr || '';
    var dayIdx = CLASS_WEEK_DAYS.indexOf(String(dayCode).toLowerCase());
    if (dayIdx === -1) dayIdx = 0;
    var classDate = addDaysDate(mon, dayIdx);
    var y = classDate.getFullYear();
    var m = classDate.getMonth() + 1;
    var dt = classDate.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dt < 10 ? '0' : '') + dt;
  }

  /**
   * Normalise any day value ("Monday", "mon", "จันทร์", or date) to "monday" (lowercase standard for classes)
   */
  function normalizeDay(value) {
    var s = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
    if (s.indexOf('mon') === 0 || s.indexOf('จันท') !== -1 || s === 'จ.' || s === 'จ') return 'monday';
    if (s.indexOf('tue') === 0 || s.indexOf('อังค') !== -1 || s === 'อ.' || s === 'อ') return 'tuesday';
    if (s.indexOf('wed') === 0 || s.indexOf('พุธ') !== -1 || s === 'พ.' || s === 'พ') return 'wednesday';
    if (s.indexOf('thu') === 0 || s.indexOf('พฤหัส') !== -1 || s === 'พฤ.' || s === 'พฤ') return 'thursday';
    if (s.indexOf('fri') === 0 || s.indexOf('ศุก') !== -1 || s === 'ศ.' || s === 'ศ') return 'friday';
    if (s.indexOf('sat') === 0 || s.indexOf('เสาร') !== -1 || s === 'ส.' || s === 'ส') return 'saturday';
    if (s.indexOf('sun') === 0 || s.indexOf('อาทิต') !== -1 || s === 'อา.' || s === 'อา') return 'sunday';

    var d = parseDateSafe(value);
    if (d) return CLASS_DAYS_LIST[d.getDay()];
    return s;
  }

  /**
   * Normalise duty day value ("Mon", "monday", "จันทร์", or date) to "Mon" (3-letter capitalized standard for duty)
   */
  function normalizeDutyDay(value) {
    var s = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
    if (s.indexOf('mon') === 0 || s.indexOf('จันท') !== -1 || s === 'จ.' || s === 'จ') return 'Mon';
    if (s.indexOf('tue') === 0 || s.indexOf('อังค') !== -1 || s === 'อ.' || s === 'อ') return 'Tue';
    if (s.indexOf('wed') === 0 || s.indexOf('พุธ') !== -1 || s === 'พ.' || s === 'พ') return 'Wed';
    if (s.indexOf('thu') === 0 || s.indexOf('พฤหัส') !== -1 || s === 'พฤ.' || s === 'พฤ') return 'Thu';
    if (s.indexOf('fri') === 0 || s.indexOf('ศุก') !== -1 || s === 'ศ.' || s === 'ศ') return 'Fri';
    if (s.indexOf('sat') === 0 || s.indexOf('เสาร') !== -1 || s === 'ส.' || s === 'ส') return 'Sat';
    if (s.indexOf('sun') === 0 || s.indexOf('อาทิต') !== -1 || s === 'อา.' || s === 'อา') return 'Sun';

    var d = parseDateSafe(value);
    if (d) return DUTY_DAYS_LIST[d.getDay()];
    return value;
  }

  function timeToMinutes(hhmm) {
    var p = hhmm.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  function str(value, max) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    return s.length > (max || 500) ? s.substring(0, max || 500) : s;
  }

  function parseJsonArray(json, label) {
    var parsed = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(parsed)) throw new Error(label + ' must be a list');
    return parsed;
  }

  /**
   * Generate unique ID
   */
  function generateId() {
    return Utilities.getUuid();
  }

  // ═════════════════════════════════════════════════════════
  // MODULE: CLASS SCHEDULE
  // ═════════════════════════════════════════════════════════

  function getClassesSheet() { return ensureSheet(SHEET_CLASSES, CLASSES_HEADERS); }
  function getPoolSheet()    { return ensureSheet(SHEET_POOL, POOL_HEADERS); }

  /**
   * Row array → object
   */
  function rowToClass(row) {
    if (row.length >= 9) {
      return {
        id:            row[0] || '',
        subject_code:  row[1] || '',
        subject_name:  row[2] || '',
        week_start:    normalizeWeekStart(row[3]),
        day:           normalizeDay(row[4]),
        start_time:    normalizeTime(row[5]),
        end_time:      normalizeTime(row[6]),
        room:          row[7] || '',
        color:         row[8] || '#6366f1',
        slide_url:     row[9] || '',
        meeting_url:   row[10] || '',
        session_notes: row[11] || ''
      };
    }
    return {
      id:            row[0] || '',
      subject_code:  row[1] || '',
      subject_name:  row[2] || '',
      week_start:    '',
      day:           normalizeDay(row[3]),
      start_time:    normalizeTime(row[4]),
      end_time:      normalizeTime(row[5]),
      room:          row[6] || '',
      color:         row[7] || '#6366f1',
      slide_url:     '',
      meeting_url:   '',
      session_notes: ''
    };
  }

  function rowToSubject(row) {
    return {
      id:           row[0] || '',
      subject_code: row[1] || '',
      subject_name: row[2] || '',
      room:         row[3] || '',
      color:        row[4] || '#6366f1'
    };
  }

  /**
   * Get all scheduled classes
   */
  function getAllClasses() {
    try {
      var sheet = getClassesSheet();
      var props = PropertiesService.getUserProperties();
      var upgraded = props.getProperty('uniplan_paramedic_v3');
      if (upgraded !== 'true') {
        seedSampleData(true);
        props.setProperty('uniplan_paramedic_v3', 'true');
      }
      var rows = readRows(sheet, CLASSES_HEADERS.length);
      if (rows.length === 0) {
        seedSampleData(true);
        rows = readRows(sheet, CLASSES_HEADERS.length);
      }
      return { success: true, data: rows.map(rowToClass) };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Save ALL classes (overwrite)
   */
  function saveAllClasses(classesJson) {
    var lock = null;
    try {
      var classes = parseJsonArray(classesJson, 'Classes');
      var sheet = getClassesSheet(); // resolve before locking (creation takes the same lock)
      lock = LockService.getUserLock();
      lock.waitLock(10000);
      var rows = classes.map(function(c) {
        return [
          str(c.id, 100) || generateId(),
          str(c.subject_code, 100),
          str(c.subject_name, 300),
          getClassDate(c.week_start, c.day) || str(c.week_start, 20),
          str(c.day, 20),
          normalizeTime(c.start_time),
          normalizeTime(c.end_time),
          str(c.room, 100),
          str(c.color, 20) || '#6366f1',
          str(c.slide_url, 1000),
          str(c.meeting_url, 1000),
          str(c.session_notes, 2000)
        ];
      });
      overwriteRows(sheet, CLASSES_HEADERS.length, rows);
      return { success: true };
    } catch(e) {
      return { success: false, error: e.message };
    } finally {
      if (lock) lock.releaseLock();
    }
  }

  /**
   * Get subject pool
   */
  function getSubjectPool() {
    try {
      var sheet = getPoolSheet();
      var props = PropertiesService.getUserProperties();
      var upgraded = props.getProperty('uniplan_paramedic_v3');
      if (upgraded !== 'true') {
        seedSampleData(true);
        props.setProperty('uniplan_paramedic_v3', 'true');
      }
      var rows = readRows(sheet, POOL_HEADERS.length);
      if (rows.length === 0) {
        seedSampleData(true);
        rows = readRows(sheet, POOL_HEADERS.length);
      }
      return { success: true, data: rows.map(rowToSubject) };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Save ALL subjects in pool (overwrite)
   */
  function saveSubjectPool(subjectsJson) {
    var lock = null;
    try {
      var subjects = parseJsonArray(subjectsJson, 'Subjects');
      var sheet = getPoolSheet();
      lock = LockService.getUserLock();
      lock.waitLock(10000);
      var rows = subjects.map(function(s) {
        return [
          str(s.id, 100) || generateId(),
          str(s.subject_code, 100),
          str(s.subject_name, 300),
          str(s.room, 100),
          str(s.color, 20) || '#6366f1'
        ];
      });
      overwriteRows(sheet, POOL_HEADERS.length, rows);
      return { success: true };
    } catch(e) {
      return { success: false, error: e.message };
    } finally {
      if (lock) lock.releaseLock();
    }
  }

  // ═════════════════════════════════════════════════════════
  // MODULE: DUTY / ROTA
  // ═════════════════════════════════════════════════════════

  /**
   * Read the whole rota: time slots, members and assignments
   */
  function getDutyData() {
    try {
      var slotSheet = ensureSheet(SHEET_DUTY_SLOTS, DUTY_SLOT_HEADERS);
      var memberSheet = ensureSheet(SHEET_DUTY_MEMBERS, DUTY_MEMBER_HEADERS);
      var dutySheet = ensureSheet(SHEET_DUTY, DUTY_HEADERS);

      var memberRows = readRows(memberSheet, DUTY_MEMBER_HEADERS.length);
      if (memberRows.length === 0) {
        seedSampleData(false);
        slotSheet = ensureSheet(SHEET_DUTY_SLOTS, DUTY_SLOT_HEADERS);
        memberSheet = ensureSheet(SHEET_DUTY_MEMBERS, DUTY_MEMBER_HEADERS);
        dutySheet = ensureSheet(SHEET_DUTY, DUTY_HEADERS);
      }

      var slotRows = readRows(slotSheet, DUTY_SLOT_HEADERS.length);
      memberRows = readRows(memberSheet, DUTY_MEMBER_HEADERS.length);
      var dutyRows = readRows(dutySheet, DUTY_HEADERS.length, false);
      var needsSheetUpdate = false;
      var updatedDutyRows = [];

      var slots = slotRows.map(function(r) {
        return { start: normalizeTime(r[0]), end: normalizeTime(r[1]) };
      }).filter(function(s) { return s.start && s.end; });
      slots.sort(function(a, b) { return timeToMinutes(a.start) - timeToMinutes(b.start) || timeToMinutes(a.end) - timeToMinutes(b.end); });

      var members = memberRows.map(function(r) {
        return { name: r[0], color: r[1] || '#6366f1' };
      });

      var assignments = dutyRows.map(function(r) {
        var week_start = '', day = '', start = '', end = '', duty_name = '', person = '', notes = '';
        var t1 = normalizeTime(r[1]), t2 = normalizeTime(r[2]), t3 = normalizeTime(r[3]);

        if (t1 && t2) {
          // 6-column format: Day, Start, End, DutyName, Person, Notes
          var col0 = r[0];
          day = normalizeDutyDay(col0);
          var d0 = parseDateSafe(col0);
          if (d0) {
            week_start = getWeekStartISO(d0);
            if (!day) day = DUTY_DAYS_LIST[d0.getDay()];
          }
          start = t1;
          end = t2;
          duty_name = r[3] || '';
          person = r[4] || '';
          notes = r[5] || '';
          needsSheetUpdate = true;
        } else {
          // 7-column format: Date, Day, Start, End, DutyName, Person, Notes
          var d0 = parseDateSafe(r[0]);
          if (d0) {
            week_start = getWeekStartISO(d0);
          }
          day = normalizeDutyDay(r[1]);
          start = t2;
          end = t3;
          duty_name = r[4] || '';
          person = r[5] || '';
          notes = r[6] || '';

          if (!day && d0) {
            day = DUTY_DAYS_LIST[d0.getDay()];
          }
          if (!week_start && r[1]) {
            var d1 = parseDateSafe(r[1]);
            if (d1) week_start = getWeekStartISO(d1);
          }
        }

        var exactDate = getDutyAssignmentDate(week_start, day);
        if (exactDate && r[0] !== exactDate) {
          needsSheetUpdate = true;
        }

        if (start && end && person && DUTY_DAYS.indexOf(day) !== -1) {
          updatedDutyRows.push([
            exactDate || r[0] || '',
            day,
            start,
            end,
            duty_name,
            person,
            notes
          ]);
        }

        return {
          week_start: week_start,
          day:       day,
          start:     start,
          end:       end,
          duty_name: duty_name,
          person:    person,
          notes:     notes
        };
      }).filter(function(a) { return a.start && a.end && a.person && DUTY_DAYS.indexOf(a.day) !== -1; });

      if (needsSheetUpdate && updatedDutyRows.length > 0) {
        try {
          overwriteRows(dutySheet, DUTY_HEADERS.length, updatedDutyRows);
        } catch(err) {
          // non-critical auto-sync
        }
      }

      return { success: true, data: { slots: slots, members: members, assignments: assignments } };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Validate and save the whole rota (overwrite all three sheets)
   * Expected payload: { slots: [{start,end}], members: [{name,color}],
   *                     assignments: [{day,start,end,duty_name,person,notes}] }
   */
  function saveDutyData(dutyJson) {
    var lock = null;
    try {
      var payload = typeof dutyJson === 'string' ? JSON.parse(dutyJson) : dutyJson;
      if (!payload) throw new Error('Empty rota payload');
      var slotsIn = parseJsonArray(payload.slots || [], 'Slots');
      var membersIn = parseJsonArray(payload.members || [], 'Members');
      var assignIn = parseJsonArray(payload.assignments || [], 'Assignments');

      // ── Slots ──
      var slotKeys = {};
      var slots = [];
      slotsIn.forEach(function(s) {
        var start = normalizeTime(s.start), end = normalizeTime(s.end);
        if (!start || !end) throw new Error('Invalid time slot');
        if (timeToMinutes(end) <= timeToMinutes(start)) throw new Error('Slot ' + start + ' - ' + end + ': end must be after start');
        var key = start + '-' + end;
        if (slotKeys[key]) return; // drop duplicates
        slotKeys[key] = true;
        slots.push({ start: start, end: end });
      });

      // ── Members ──
      var memberNames = {};
      var members = [];
      membersIn.forEach(function(m) {
        var name = str(m.name, 100);
        if (!name) throw new Error('Member name is required');
        var lower = name.toLowerCase();
        if (memberNames[lower]) throw new Error('Duplicate member: ' + name);
        memberNames[lower] = name;
        members.push({ name: name, color: str(m.color, 20) || '#6366f1' });
      });

      // ── Assignments ──
      var assignments = [];
      assignIn.forEach(function(a) {
        var day = normalizeDutyDay(a.day);
        if (DUTY_DAYS.indexOf(day) === -1) throw new Error('Invalid day: ' + a.day);
        var start = normalizeTime(a.start), end = normalizeTime(a.end);
        if (!slotKeys[start + '-' + end]) throw new Error('Assignment uses an unknown time slot: ' + start + ' - ' + end);
        var person = memberNames[str(a.person, 100).toLowerCase()];
        if (!person) throw new Error('Assignment uses an unknown member: ' + a.person);
        assignments.push({
          week_start: normalizeWeekStart(a.week_start),
          day: day, start: start, end: end, person: person,
          duty_name: str(a.duty_name, 200), notes: str(a.notes, 1000)
        });
      });

      // ── Conflict check: same person, same week, same day, overlapping slots ──
      var byPersonDay = {};
      assignments.forEach(function(a) {
        var k = a.person + '|' + (a.week_start || '') + '|' + a.day;
        (byPersonDay[k] = byPersonDay[k] || []).push(a);
      });
      Object.keys(byPersonDay).forEach(function(k) {
        var list = byPersonDay[k];
        for (var i = 0; i < list.length; i++) {
          for (var j = i + 1; j < list.length; j++) {
            if (timeToMinutes(list[i].start) < timeToMinutes(list[j].end) &&
                timeToMinutes(list[i].end) > timeToMinutes(list[j].start)) {
              throw new Error('Time conflict: ' + list[i].person + ' on ' + list[i].day + ' (' +
                list[i].start + '-' + list[i].end + ' / ' + list[j].start + '-' + list[j].end + ')');
            }
          }
        }
      });

      // Resolve sheets before locking (creation takes the same lock)
      var slotSheet = ensureSheet(SHEET_DUTY_SLOTS, DUTY_SLOT_HEADERS);
      var memberSheet = ensureSheet(SHEET_DUTY_MEMBERS, DUTY_MEMBER_HEADERS);
      var dutySheet = ensureSheet(SHEET_DUTY, DUTY_HEADERS);

      lock = LockService.getUserLock();
      lock.waitLock(10000);
      overwriteRows(slotSheet, DUTY_SLOT_HEADERS.length, slots.map(function(s) { return [s.start, s.end]; }));
      overwriteRows(memberSheet, DUTY_MEMBER_HEADERS.length, members.map(function(m) { return [m.name, m.color]; }));
      overwriteRows(dutySheet, DUTY_HEADERS.length, assignments.map(function(a) {
        var shiftDate = getDutyAssignmentDate(a.week_start, a.day);
        return [shiftDate, a.day, a.start, a.end, a.duty_name, a.person, a.notes];
      }));
      return { success: true };
    } catch(e) {
      return { success: false, error: e.message };
    } finally {
      if (lock) lock.releaseLock();
    }
  }

  /**
   * Seed sample data into Google Sheets if empty, or when force=true
   */
  function seedSampleData(force) {
    try {
      var ss = getOrCreateSpreadsheet();
      var classSheet = ensureSheet(SHEET_CLASSES, CLASSES_HEADERS);
      var poolSheet = ensureSheet(SHEET_POOL, POOL_HEADERS);
      var slotSheet = ensureSheet(SHEET_DUTY_SLOTS, DUTY_SLOT_HEADERS);
      var memberSheet = ensureSheet(SHEET_DUTY_MEMBERS, DUTY_MEMBER_HEADERS);
      var dutySheet = ensureSheet(SHEET_DUTY, DUTY_HEADERS);

      var props = PropertiesService.getUserProperties();
      var alreadySeeded = props.getProperty('uniplan_seeded');
      if (!force && alreadySeeded === 'true') {
        return { success: true, url: ss.getUrl() };
      }

      var lock = LockService.getUserLock();
      lock.waitLock(10000);
      try {
        if (force || classSheet.getLastRow() <= 1) {
          var samplePool = [
            ['sub_rapm201', 'RAPM201', 'สรีรวิทยาและบูรณาการสำหรับฉุกเฉินการแพทย์ ๑', '1C05', '#6366f1'],
            ['sub_rapm202', 'RAPM202', 'พื้นฐานทางคลินิกสำหรับฉุกเฉินการแพทย์', '1C05 / Onsite', '#ef4444'],
            ['sub_rapm203', 'RAPM203', 'ชีวเคมีพื้นฐานสำหรับฉุกเฉินการแพทย์', 'อาคารพรีคลินิก', '#10b981'],
            ['sub_rapm208', 'RAPM208', 'ระบาดวิทยาคลินิกสำหรับฉุกเฉินการแพทย์', 'ห้องเรียน RASME', '#06b6d4'],
            ['sub_shhu161', 'SHHU161', 'พลวัต และการทำงานเป็นทีม', 'Online', '#f59e0b'],
            ['sub_shss250', 'SHSS250', 'PH Laws & Regulations', 'Online', '#ec4899']
          ];
          overwriteRows(poolSheet, POOL_HEADERS.length, samplePool);

          var sampleClasses = [
            // ── Week 1: 2 Nov – 8 Nov 2026 (2026-11-02) ──
            ['cls_w1_1', 'RAPM201', 'Data gathering and decision making', '2026-11-02', 'monday', '09:00', '12:00', '1C05', '#6366f1'],
            ['cls_w1_2', 'RAPM203', 'Amino acid metabolism and diseases', '2026-11-02', 'monday', '13:00', '15:00', 'อาคารพรีคลินิก', '#10b981'],
            ['cls_w1_3', 'RAPM202', 'History and PE in Pediatric', '2026-11-02', 'tuesday', '09:00', '12:00', '1C05', '#ef4444'],
            ['cls_w1_4', 'RAPM208', 'Clinical Prediction rule (CPR) + JC', '2026-11-02', 'wednesday', '09:00', '12:00', 'ห้องเรียน RASME', '#06b6d4'],
            ['cls_w1_5', 'RAPM202', 'WS: Pediatric assessment', '2026-11-02', 'thursday', '09:00', '12:00', '1C05', '#ef4444'],
            ['cls_w1_6', 'RAPM201', 'Integration of clinical pathophysiology', '2026-11-02', 'thursday', '13:00', '16:00', '1C04-1C05', '#6366f1'],
            ['cls_w1_7', 'SHHU161', 'เทคนิคการทำงานเป็นทีม (๒)', '2026-11-02', 'friday', '08:30', '10:30', 'Online', '#f59e0b'],
            ['cls_w1_8', 'SHSS250', 'PH Laws & Regulations', '2026-11-02', 'friday', '13:00', '15:00', 'Online', '#ec4899'],

            // ── Week 2: 9 Nov – 15 Nov 2026 (2026-11-09) ──
            ['cls_w2_1', 'RAPM203', 'Metabolic pathway & Hormonal regulation', '2026-11-09', 'monday', '13:00', '15:00', 'อาคารพรีคลินิก', '#10b981'],
            ['cls_w2_2', 'RAPM202', 'หลักการซักประวัติทางจิตเวช (Onsite)', '2026-11-09', 'tuesday', '09:00', '10:30', 'Onsite (1C05)', '#ef4444'],
            ['cls_w2_3', 'RAPM208', 'Non-R design', '2026-11-09', 'wednesday', '09:00', '11:00', 'ห้องเรียน RASME', '#06b6d4'],
            ['cls_w2_4', 'RAPM202', 'การซักประวัติ ตรวจร่างกาย หู คอ จมูก & จักษุ (Online)', '2026-11-09', 'thursday', '09:00', '11:30', 'Online', '#ef4444'],
            ['cls_w2_5', 'SHHU161', 'ภาวะผู้นำกับการทำงานเป็นทีม', '2026-11-09', 'friday', '08:30', '10:30', 'Online', '#f59e0b'],
            ['cls_w2_6', 'SHSS250', 'PH Laws & Regulations', '2026-11-09', 'friday', '13:00', '15:00', 'Online', '#ec4899'],

            // ── Week 3: 16 Nov – 22 Nov 2026 (2026-11-16) ──
            ['cls_w3_1', 'RAPM201', 'Case presentation', '2026-11-16', 'monday', '09:00', '12:00', '1C05', '#6366f1'],
            ['cls_w3_2', 'RAPM202', 'WS: การตรวจร่างกาย ตา หู คอ จมูก', '2026-11-16', 'tuesday', '09:00', '11:00', 'sim CNMI', '#ef4444'],
            ['cls_w3_3', 'RAPM208', 'Systematic review & Meta analysis + JC', '2026-11-16', 'wednesday', '09:00', '12:00', 'ห้องเรียน RASME', '#06b6d4'],
            ['cls_w3_4', 'SHHU161', 'ประเด็นจริยธรรมที่พบในการทำงานเป็นทีม', '2026-11-16', 'friday', '08:30', '10:30', 'Online', '#f59e0b'],
            ['cls_w3_5', 'SHSS250', 'PH Laws & Regulations', '2026-11-16', 'friday', '13:00', '15:00', 'Online', '#ec4899'],

            // ── Week 4: 23 Nov – 29 Nov 2026 (2026-11-23) ──
            ['cls_w4_1', 'RAPM201', 'Q&A (online)', '2026-11-23', 'monday', '09:00', '12:00', 'Online (Zoom)', '#6366f1'],
            ['cls_w4_2', 'RAPM203', 'TBL: Integrated metabolism', '2026-11-23', 'monday', '13:00', '15:00', 'อาคารพรีคลินิก', '#10b981'],
            ['cls_w4_3', 'RAPM208', 'Putting It All Together II + Quiz', '2026-11-23', 'wednesday', '09:00', '11:00', 'ห้องเรียน RASME', '#06b6d4'],
            ['cls_w4_4', 'SHHU161', 'สรุป - นำเสนอผลงานของกลุ่ม', '2026-11-23', 'friday', '08:30', '10:30', 'Online', '#f59e0b'],
            ['cls_w4_5', 'SHSS250', 'PH Laws & Regulations', '2026-11-23', 'friday', '13:00', '15:00', 'Online', '#ec4899'],

            // ── Week 5: 30 Nov – 6 Dec 2026 (2026-11-30) ──
            ['cls_w5_1', 'RAPM201', 'สอบปลายภาค', '2026-11-30', 'monday', '09:00', '12:00', 'ห้องคอมชั้น 5', '#6366f1'],
            ['cls_w5_2', 'RAPM203', 'สอบครั้งที่ 2', '2026-11-30', 'monday', '13:00', '15:00', 'ห้องคอมชั้น 5', '#10b981'],
            ['cls_w5_3', 'RAPM202', 'OSCE', '2026-11-30', 'tuesday', '09:00', '12:00', 'sim CNMI', '#ef4444'],
            ['cls_w5_4', 'RAPM208', 'Final Examination (SAQ)', '2026-11-30', 'wednesday', '09:00', '12:00', 'ห้องเรียน RASME', '#06b6d4'],
            ['cls_w5_5', 'RAPM202', 'SAQ', '2026-11-30', 'thursday', '09:00', '12:00', 'อาคารพรีคลินิกชั้น 1 โซน C', '#ef4444']
          ];
          var paddedClasses = sampleClasses.map(function(r) {
            while (r.length < CLASSES_HEADERS.length) r.push('');
            return r;
          });
          overwriteRows(classSheet, CLASSES_HEADERS.length, paddedClasses);
        }

        if (force || memberSheet.getLastRow() <= 1) {
          var sampleSlots = [
            ['08:00', '12:00'],
            ['12:00', '16:00'],
            ['16:00', '20:00']
          ];
          overwriteRows(slotSheet, DUTY_SLOT_HEADERS.length, sampleSlots);

          var sampleMembers = [
            ['Alex', '#6366f1'],
            ['Bella', '#ec4899'],
            ['Charlie', '#10b981'],
            ['David', '#f59e0b']
          ];
          overwriteRows(memberSheet, DUTY_MEMBER_HEADERS.length, sampleMembers);

          var sampleDuty = [
            // Week 1: 2 Nov 2026
            ['2026-11-02', 'Mon', '08:00', '12:00', 'Morning Shift', 'Alex', 'Front Desk'],
            ['2026-11-02', 'Mon', '12:00', '16:00', 'Afternoon Shift', 'Bella', 'Support'],
            ['2026-11-03', 'Tue', '08:00', '12:00', 'Morning Shift', 'Charlie', 'Lab Duty'],
            ['2026-11-03', 'Tue', '12:00', '16:00', 'Afternoon Shift', 'David', 'General'],
            ['2026-11-04', 'Wed', '08:00', '12:00', 'Morning Shift', 'Bella', 'Front Desk'],
            ['2026-11-04', 'Wed', '12:00', '16:00', 'Afternoon Shift', 'Alex', 'Support'],
            ['2026-11-05', 'Thu', '08:00', '12:00', 'Morning Shift', 'David', 'Lab Duty'],
            ['2026-11-05', 'Thu', '12:00', '16:00', 'Afternoon Shift', 'Charlie', 'General'],
            ['2026-11-06', 'Fri', '12:00', '16:00', 'Afternoon Shift', 'Alex', 'Support'],
            ['2026-11-06', 'Fri', '16:00', '20:00', 'Evening Shift', 'Bella', 'Closing'],

            // Week 2: 9 Nov 2026
            ['2026-11-09', 'Mon', '08:00', '12:00', 'Morning Shift', 'Charlie', 'Front Desk'],
            ['2026-11-09', 'Mon', '12:00', '16:00', 'Afternoon Shift', 'David', 'Support'],
            ['2026-11-10', 'Tue', '08:00', '12:00', 'Morning Shift', 'Alex', 'Lab Duty'],
            ['2026-11-11', 'Wed', '12:00', '16:00', 'Afternoon Shift', 'Bella', 'Support'],
            ['2026-11-12', 'Thu', '08:00', '12:00', 'Morning Shift', 'Charlie', 'Lab Duty'],
            ['2026-11-13', 'Fri', '16:00', '20:00', 'Evening Shift', 'David', 'Closing']
          ];
          overwriteRows(dutySheet, DUTY_HEADERS.length, sampleDuty);
        }

        props.setProperty('uniplan_seeded', 'true');
        return { success: true, url: ss.getUrl() };
      } finally {
        lock.releaseLock();
      }
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  function getSpreadsheetUrl() {
    try {
      var ss = getOrCreateSpreadsheet();
      ensureSheet(SHEET_CLASSES, CLASSES_HEADERS);
      ensureSheet(SHEET_POOL, POOL_HEADERS);
      ensureSheet(SHEET_DUTY_SLOTS, DUTY_SLOT_HEADERS);
      ensureSheet(SHEET_DUTY_MEMBERS, DUTY_MEMBER_HEADERS);
      ensureSheet(SHEET_DUTY, DUTY_HEADERS);
      return { success: true, url: ss.getUrl(), id: ss.getId() };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  var SHEET_GRADES = 'Grades';
  var GRADES_HEADERS = ['SubjectCode', 'SubjectName', 'Credits', 'ComponentName', 'WeightPct', 'EarnedScore', 'MaxScore', 'WeightedScorePct'];

  /**
   * Read & save Study Hub data (Grade calculator components + Study timer logs)
   */
  function getStudyData() {
    try {
      var props = PropertiesService.getUserProperties();
      var raw = props.getProperty('uniplan_study_data');
      var data = raw ? JSON.parse(raw) : { grades: {}, credits: {}, cutoffs: {}, customSubjects: [], sessions: [] };
      return { success: true, data: data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function saveStudyData(studyJson) {
    try {
      var parsed = typeof studyJson === 'string' ? JSON.parse(studyJson || '{}') : (studyJson || {});
      var strData = JSON.stringify(parsed);
      PropertiesService.getUserProperties().setProperty('uniplan_study_data', strData);

      // Also sync a structured Grades sheet in Google Sheets for easy viewing/export
      try {
        var gradeSheet = ensureSheet(SHEET_GRADES, GRADES_HEADERS);
        var gradesMap = parsed.grades || {};
        var creditsMap = parsed.credits || {};
        var subjNames = parsed.subjectNames || {};
        var rows = [];
        Object.keys(gradesMap).forEach(function(code) {
          var items = gradesMap[code] || [];
          var cred = creditsMap[code] !== undefined ? creditsMap[code] : 3;
          var sName = subjNames[code] || '';
          items.forEach(function(it) {
            var w = parseFloat(it.weight) || 0;
            var e = (it.earned === '' || it.earned === null || it.earned === undefined) ? '' : parseFloat(it.earned);
            var m = parseFloat(it.max) || 100;
            var weighted = (e !== '' && !isNaN(e) && m > 0) ? ((e / m) * w).toFixed(2) : '';
            rows.push([
              str(code, 50),
              str(sName, 200),
              String(cred),
              str(it.name, 200),
              String(w),
              e === '' ? '' : String(e),
              String(m),
              weighted
            ]);
          });
        });
        overwriteRows(gradeSheet, GRADES_HEADERS.length, rows);
      } catch (sheetErr) {}

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return {
    getAllClasses:      getAllClasses,
    saveAllClasses:    saveAllClasses,
    getSubjectPool:    getSubjectPool,
    saveSubjectPool:   saveSubjectPool,
    getDutyData:       getDutyData,
    saveDutyData:      saveDutyData,
    seedSampleData:    seedSampleData,
    getSpreadsheetUrl: getSpreadsheetUrl,
    getStudyData:      getStudyData,
    saveStudyData:     saveStudyData
  };

})();
