// ============================================================
// Code.gs — Main Entry Point & Router
// Every function below is exposed to the browser via google.script.run
// ============================================================

/**
 * Serves the main HTML page, or handles GET API requests when ?action=... is passed
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    var args = [];
    if (e.parameter.args) {
      try { args = JSON.parse(e.parameter.args); } catch (err) {}
    }
    return handleApiRequest(e.parameter.action, args);
  }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('UniPlan')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

/**
 * Handles POST API requests from Vercel / external frontend
 * Uses Content-Type: text/plain JSON body to avoid CORS preflight
 */
function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var body = JSON.parse(raw);
    return handleApiRequest(body.action, body.args || []);
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleApiRequest(action, args) {
  var handlers = {
    getCurrentUser:      getCurrentUser,
    getTasksByDateRange: getTasksByDateRange,
    createTask:          createTask,
    updateTask:          updateTask,
    moveTask:            moveTask,
    markTaskDone:        markTaskDone,
    markTaskUndone:      markTaskUndone,
    deleteTask:          deleteTask,
    getWeeklyStats:      getWeeklyStats,
    getDutyData:         getDutyData,
    saveDutyData:        saveDutyData,
    syncDutyToCalendar:  syncDutyToCalendar,
    sendDutyToDiscord:   sendDutyToDiscord,
    getAllClasses:       getAllClasses,
    saveAllClasses:      saveAllClasses,
    getSubjectPool:      getSubjectPool,
    saveSubjectPool:       saveSubjectPool,
    saveClasses:           saveClasses,
    syncClassesToCalendar: syncClassesToCalendar,
    sendClassesToDiscord:  sendClassesToDiscord,
    getStudyData:          getStudyData,
    saveStudyData:         saveStudyData,
    seedSampleData:        seedSampleData,
    getSpreadsheetUrl:     getSpreadsheetUrl
  };

  var fn = handlers[action];
  if (!fn) {
    return jsonResponse({ success: false, error: 'Unknown API action: ' + action });
  }
  try {
    var result = fn.apply(null, Array.isArray(args) ? args : []);
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) });
  }
}

/**
 * Include HTML partials
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Get current user email
 */
function getCurrentUser() {
  try {
    return Session.getActiveUser().getEmail();
  } catch (e) {
    return '';
  }
}

// ============================================================
// Module 1: Tasks / Calendar API Wrappers
// ============================================================

/**
 * @param {string} startDateStr ISO start of range
 * @param {string} endDateStr ISO end of range
 * @return {{success:boolean, data:Array, error:string}} tasks + Thai holidays
 */
function getTasksByDateRange(startDateStr, endDateStr) {
  return CalendarService.getTasksByDateRange(startDateStr, endDateStr);
}

/**
 * @param {Object} taskData {title, startTime, endTime, description, priority}
 */
function createTask(taskData) {
  return CalendarService.createTask(taskData);
}

/**
 * @param {string} eventId Calendar event id
 * @param {Object} taskData {title, startTime, endTime, description, priority, isDone}
 */
function updateTask(eventId, taskData) {
  return CalendarService.updateTask(eventId, taskData);
}

/**
 * Drag-to-reschedule: move a task by a whole number of days
 * @param {string} eventId Calendar event id
 * @param {number} deltaDays Positive or negative number of days
 */
function moveTask(eventId, deltaDays) {
  return CalendarService.moveTask(eventId, deltaDays);
}

function markTaskDone(eventId) {
  return CalendarService.markTaskDone(eventId);
}

function markTaskUndone(eventId, priority) {
  return CalendarService.markTaskUndone(eventId, priority);
}

function deleteTask(eventId) {
  return CalendarService.deleteTask(eventId);
}

/**
 * @param {string} weekStartStr ISO date of the Monday of the week
 */
function getWeeklyStats(weekStartStr) {
  return CalendarService.getWeeklyStats(weekStartStr);
}

// ============================================================
// Module 2: Duty / Rota — Sheets API Wrappers
// ============================================================

/**
 * @return {{success:boolean, data:{slots:Array, members:Array, assignments:Array}}}
 */
function getDutyData() {
  return SheetsService.getDutyData();
}

/**
 * @param {string} dutyJson JSON {slots, members, assignments}
 */
function saveDutyData(dutyJson) {
  return SheetsService.saveDutyData(dutyJson);
}

/**
 * Sync duty rota shifts to Google Calendar
 * @param {Object} options {member, weekStart}
 */
function syncDutyToCalendar(options) {
  return CalendarService.syncDutyToCalendar(options);
}

/**
 * Send weekly duty rota summary to Discord
 * @param {Object} options {weekStart, member}
 */
function sendDutyToDiscord(options) {
  return CalendarService.sendDutyToDiscord(options);
}

// ============================================================
// Module 3: Class Schedule / Sheets API Wrappers
// ============================================================

function getAllClasses() {
  return SheetsService.getAllClasses();
}

function saveAllClasses(classesJson) {
  return SheetsService.saveAllClasses(classesJson);
}

function getSubjectPool() {
  return SheetsService.getSubjectPool();
}

function saveSubjectPool(subjectsJson) {
  return SheetsService.saveSubjectPool(subjectsJson);
}

/**
 * Save the timetable and the subject pool together (Save Timetable button)
 * @param {Array} classes placed class blocks
 * @param {Array} subjectPool subjects in the pool
 */
function saveClasses(classes, subjectPool) {
  var classesJson = JSON.stringify(classes);
  var poolJson = JSON.stringify(subjectPool);

  var res1 = SheetsService.saveAllClasses(classesJson);
  if (!res1.success) throw new Error(res1.error);

  var res2 = SheetsService.saveSubjectPool(poolJson);
  if (!res2.success) throw new Error(res2.error);

  return { success: true };
}

function syncClassesToCalendar(options) {
  return CalendarService.syncClassesToCalendar(options);
}

function sendClassesToDiscord(options) {
  return CalendarService.sendClassesToDiscord(options);
}

// ============================================================
// Module 4: Study Hub (Grades & Pomodoro/OSCE Timer Logs)
// ============================================================

function getStudyData() {
  return SheetsService.getStudyData();
}

function saveStudyData(studyJson) {
  return SheetsService.saveStudyData(studyJson);
}

/**
 * Seed sample data into Google Sheets if empty or when force=true
 * @param {boolean} force
 */
function seedSampleData(force) {
  return SheetsService.seedSampleData(force);
}

/**
 * Get the Google Spreadsheet URL and ID
 */
function getSpreadsheetUrl() {
  return SheetsService.getSpreadsheetUrl();
}
