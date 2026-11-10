// ============================================================
//  CalendArt Discord Bot — Google Apps Script
//  แจ้งเตือน Google Calendar → Discord Webhook
// ============================================================

// ── Config ──────────────────────────────────────────────────
const WEBHOOK_URL =
  ['https://discord.com/api', 'webhooks', '1516324154930892891', '1H4mjugCKn1K1rzFngheFxsPZQqwSigkIIXJ483wOfCMyN5jcoqvRAxHAHGV1AynVvEP'].join('/');

const CALENDAR_ID = '9ef6e0f63421ecb219ae4d87fa15d17745428631dd498b07e3e0cfa223234683@group.calendar.google.com';
const TIMEZONE   = 'Asia/Bangkok';
const BOT_NAME   = 'CalendArt Bot';
const BOT_ICON   = 'https://www.gstatic.com/images/branding/product/2x/calendar_48dp.png';

// สีธีม Discord embeds (hex → decimal)
const COLOR_DAILY  = 0x4285F4; // Google Blue
const COLOR_WEEKLY = 0x34A853; // Google Green
const COLOR_REMIND = 0xFBBC04; // Google Yellow

// ── Helpers ──────────────────────────────────────────────────

/**
 * ส่งข้อความไปยัง Discord webhook
 * @param {string|null} content  ข้อความธรรมดา (รองรับ @here / @everyone)
 * @param {Array}       embeds   อาร์เรย์ของ embed objects
 */
function sendDiscord(content, embeds) {
  const body = { username: BOT_NAME, avatar_url: BOT_ICON };
  if (content) body.content = content;
  if (embeds && embeds.length) body.embeds = embeds;

  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
}

/** แปลง Date เป็นสตริงวันที่ภาษาไทย */
function thaiDate(date) {
  return Utilities.formatDate(date, TIMEZONE, 'd MMMM yyyy');
}

/** แปลง Date เป็นสตริงเวลา HH:mm */
function thaiTime(date) {
  return Utilities.formatDate(date, TIMEZONE, 'HH:mm');
}

/** ชื่อวันภาษาไทย (index 0 = อาทิตย์) */
const DAY_NAMES = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];

/** ดึง events ระหว่างช่วงเวลา */
function getEvents(start, end) {
  return CalendarApp.getCalendarById(CALENDAR_ID).getEvents(start, end);
}

/** วันเริ่มต้นและสิ้นสุดของวัน (00:00–23:59) ใน Bangkok */
function dayRange(date) {
  const s = new Date(date);
  s.setHours(0, 0, 0, 0);
  const e = new Date(date);
  e.setHours(23, 59, 59, 999);
  return { start: s, end: e };
}

// ── Daily Summary — ทุกวัน 07:00 ────────────────────────────

function sendDailySummary() {
  const now    = new Date();
  const { start, end } = dayRange(now);
  const events = getEvents(start, end).filter(ev => !ev.getTitle().includes('เสร็จแล้ว'));

  // วันจันทร์ → ส่งสรุปสัปดาห์ก่อน
  const dayIndex = parseInt(Utilities.formatDate(now, TIMEZONE, 'u'), 10); // 1=จันทร์ … 7=อาทิตย์
  if (dayIndex === 1) sendWeeklySummary();

  const dateLabel = thaiDate(now);
  const fields    = buildDayFields(events);

  sendDiscord(null, [{
    title  : `📅 สรุปงานวันนี้  —  ${dateLabel}`,
    color  : COLOR_DAILY,
    fields : fields,
    footer : { text: `${BOT_NAME}  •  ${events.length} รายการ` },
    timestamp: new Date().toISOString()
  }]);
}

/** สร้าง fields จากรายการ events ของวันนั้น */
function buildDayFields(events) {
  if (!events.length) {
    return [{ name: '📭 ไม่มีกำหนดการ', value: 'วันนี้ไม่มีงานหรือกิจกรรมใดๆ ✨', inline: false }];
  }
  return events.map((ev, i) => {
    const allDay  = ev.isAllDayEvent();
    const timeStr = allDay ? 'ทั้งวัน' : `${thaiTime(ev.getStartTime())} – ${thaiTime(ev.getEndTime())}`;
    const loc     = ev.getLocation()    ? `\n📍 ${ev.getLocation()}`                          : '';
    const desc    = ev.getDescription() ? `\n📝 ${ev.getDescription().substring(0, 120)}…`    : '';
    return {
      name  : `${i + 1}. ${ev.getTitle()}`,
      value : `⏰ ${timeStr}${loc}${desc}`,
      inline: false
    };
  });
}

// ── Weekly Summary — วันจันทร์ 07:00 ────────────────────────

function sendWeeklySummary() {
  const now  = new Date();

  // หาวันจันทร์ของสัปดาห์นี้
  const dayIndex = parseInt(Utilities.formatDate(now, TIMEZONE, 'u'), 10); // 1=จันทร์
  const monday   = new Date(now);
  monday.setDate(now.getDate() - (dayIndex - 1));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const allEvents = getEvents(monday, sunday);
  const fields    = [];

  for (let i = 0; i < 7; i++) {
    const day     = new Date(monday);
    day.setDate(monday.getDate() + i);
    const { start: ds, end: de } = dayRange(day);

    // กรอง events ของวันนั้น
    const dayEvents = allEvents.filter(ev => {
      const tStart = ev.getStartTime().getTime();
      const tEnd = ev.getEndTime().getTime();
      const dStart = ds.getTime();
      const dEnd = de.getTime();
      if (ev.getTitle().includes('เสร็จแล้ว')) return false;
      return (tStart <= dEnd && tEnd > dStart) || (tStart === tEnd && tStart >= dStart && tStart <= dEnd);
    });
    const dayLabel  = `${DAY_NAMES[day.getDay()]}  ${Utilities.formatDate(day, TIMEZONE, 'd/M')}`;

    if (!dayEvents.length) {
      fields.push({ name: dayLabel, value: '_ไม่มีกำหนดการ_', inline: true });
    } else {
      const lines = dayEvents.map(ev => {
        const t = ev.isAllDayEvent() ? 'ทั้งวัน' : thaiTime(ev.getStartTime());
        return `• \`${t}\` ${ev.getTitle()}`;
      }).join('\n');
      fields.push({ name: `${dayLabel}  (${dayEvents.length})`, value: lines, inline: true });
    }

    // Discord จำกัด 3 columns — เพิ่ม spacer ทุก 2 คอลัมน์ให้ layout สวย
    if ((i + 1) % 2 === 0 && i < 6) {
      fields.push({ name: '\u200B', value: '\u200B', inline: true });
    }
  }

  const mondayStr = Utilities.formatDate(monday, TIMEZONE, 'd/M/yyyy');
  const sundayStr = Utilities.formatDate(sunday,  TIMEZONE, 'd/M/yyyy');

  sendDiscord(null, [{
    title  : `🗓️ สรุปงานประจำสัปดาห์  —  ${mondayStr} ถึง ${sundayStr}`,
    color  : COLOR_WEEKLY,
    fields : fields,
    footer : { text: `${BOT_NAME}  •  รวม ${allEvents.length} รายการ` },
    timestamp: new Date().toISOString()
  }]);
}

// ── 30-Minute Reminder — ทุก 5 นาที ────────────────────────

/**
 * ตรวจสอบ events ที่จะเริ่มภายใน 25–35 นาที
 * ใช้ PropertiesService ป้องกันการแจ้งเตือนซ้ำ
 */
function checkUpcomingEvents() {
  const now     = new Date();
  const winStart = new Date(now.getTime() + 25 * 60 * 1000);
  const winEnd   = new Date(now.getTime() + 35 * 60 * 1000);

  const events   = getEvents(winStart, winEnd);
  const props    = PropertiesService.getScriptProperties();
  const notified = JSON.parse(props.getProperty('notified_ids') || '{}');
  const cutoff   = now.getTime(); // ลบ keys ที่หมดอายุแล้ว

  events.forEach(ev => {
    if (ev.isAllDayEvent()) return;
    if (ev.getTitle().includes('เสร็จแล้ว')) return;

    // ต้องให้เวลาเริ่มงานอยู่ในช่วง 25 - 35 นาทีข้างหน้านี้จริงๆ เท่านั้น 
    // เพื่อป้องกันการแจ้งเตือนซ้ำสำหรับงานที่ระยะเวลายาว (เช่น 3 ชั่วโมง)
    const startTime = ev.getStartTime().getTime();
    if (startTime < winStart.getTime() || startTime > winEnd.getTime()) {
      return;
    }

    const key = `${ev.getId()}_${startTime}`;
    if (notified[key]) return; // แจ้งเตือนไปแล้ว

    const startStr = thaiTime(ev.getStartTime());
    const loc      = ev.getLocation()    ? `\n📍 **สถานที่:** ${ev.getLocation()}`                         : '';
    const desc     = ev.getDescription() ? `\n📝 **รายละเอียด:** ${ev.getDescription().substring(0, 200)}` : '';

    sendDiscord('@here', [{
      title      : '⏰ แจ้งเตือน — อีก 30 นาที!',
      description: `**${ev.getTitle()}**\n🕐 เริ่มเวลา **${startStr}**${loc}${desc}`,
      color      : COLOR_REMIND,
      footer     : { text: `${BOT_NAME}  •  Reminder` },
      timestamp  : new Date().toISOString()
    }]);

    notified[key] = ev.getStartTime().getTime();
  });

  // ล้าง keys ที่ผ่านมาแล้วเกิน 2 ชั่วโมง ไม่ให้ properties ใหญ่เกิน
  Object.keys(notified).forEach(k => {
    if (notified[k] < cutoff - 2 * 3600 * 1000) delete notified[k];
  });
  props.setProperty('notified_ids', JSON.stringify(notified));
}

// ── Setup Triggers ───────────────────────────────────────────

/**
 * รันฟังก์ชันนี้ **ครั้งเดียว** เพื่อติดตั้ง triggers ทั้งหมด
 * Menu: Apps Script Editor → Run → setupTriggers
 */
function setupTriggers() {
  // ลบ triggers เก่าทั้งหมดก่อน
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // 1. สรุปงานประจำวัน ทุกวัน 07:00 (Bangkok)
  ScriptApp.newTrigger('sendDailySummary')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(0)
    .inTimezone(TIMEZONE)
    .create();

  // 2. ตรวจแจ้งเตือน 30 นาที — ทุก 5 นาที
  ScriptApp.newTrigger('checkUpcomingEvents')
    .timeBased()
    .everyMinutes(5)
    .create();

  // 3. แจ้งเตือนเมื่อมีการ เพิ่ม/แก้ไข/ลบ Event ใน Calendar (Real-time)
  ScriptApp.newTrigger('onCalendarUpdate')
    .forUserCalendar(CALENDAR_ID)
    .onEventUpdated()
    .create();

  // 4. ตั้งค่า Sync Token ครั้งแรก เพื่อไม่ให้ระบบข้ามการแจ้งเตือนรอบแรกสุด
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    now.setDate(now.getDate() - 1);
    
    let options = { timeMin: now.toISOString(), maxResults: 100 };
    let pageToken = null;
    let nextSyncToken = null;
    
    do {
      if (pageToken) options.pageToken = pageToken;
      const eventsList = Calendar.Events.list(CALENDAR_ID, options);
      pageToken = eventsList.nextPageToken;
      nextSyncToken = eventsList.nextSyncToken;
    } while (pageToken);
    
    if (nextSyncToken) {
      PropertiesService.getScriptProperties().setProperty('CALENDAR_SYNC_TOKEN', nextSyncToken);
      Logger.log("✅ Initialized Sync Token");
    }
  } catch(e) {
    Logger.log("Error init sync token: " + e);
  }

  Logger.log('✅ Triggers setup เรียบร้อยแล้ว!');
  Logger.log('   • sendDailySummary  → ทุกวัน 07:00 (Asia/Bangkok)');
  Logger.log('   • checkUpcomingEvents → ทุก 5 นาที');
  Logger.log('   • onCalendarUpdate → ทันทีที่มีการเปลี่ยนแปลงปฏิทิน');
}

// ── Manual Test Functions ────────────────────────────────────

/** ทดสอบส่งสรุปวันนี้ */
function testDaily()  { sendDailySummary(); }

/** ทดสอบส่งสรุปสัปดาห์นี้ */
function testWeekly() { sendWeeklySummary(); }

/** ทดสอบแจ้งเตือน 30 นาที */
function testReminder() { checkUpcomingEvents(); }

/** ทดสอบสิทธิ์เขียน Calendar (รัน function นี้เพื่อ authorize) */
function testCalendarWrite() {
  try {
    const cal = CalendarApp.getCalendarById(CALENDAR_ID);
    if (!cal) {
      Logger.log('❌ ไม่พบ Calendar ID: ' + CALENDAR_ID);
      return;
    }
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 60 * 1000);
    const ev  = cal.createEvent('🧪 Test Authorization', now, end, {
      description: 'ทดสอบสิทธิ์ — จะถูกลบทันที'
    });
    ev.deleteEvent();
    Logger.log('✅ Calendar write access: OK! Bot สามารถสร้างงานได้แล้ว');
  } catch (err) {
    Logger.log('❌ Error: ' + err.toString());
  }
}

/** ตรวจสอบระบบ Sync ของปฏิทินด้วยตัวเอง */
function debugCalendarUpdate() {
  Logger.log("=== เริ่มการทำ Debug Calendar Sync ===");
  onCalendarUpdate();
  Logger.log("=== จบการทำงาน Debug ===");
}

function removeDuplicateTriggers() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const seen = {};
    triggers.forEach(t => {
      const handler = t.getHandlerFunction();
      if (seen[handler]) {
        Logger.log('ลบ trigger ที่ซ้ำซ้อน: ' + handler + ' (ID: ' + t.getUniqueId() + ')');
        ScriptApp.deleteTrigger(t);
      } else {
        seen[handler] = true;
      }
    });
  } catch(e) {
    Logger.log('Error removing duplicate triggers: ' + e);
  }
}

// ── Calendar Sync (Add/Edit/Delete) ─────────────────────────

/**
 * ถูกเรียกใช้โดย Trigger อัตโนมัติเมื่อมีการเปลี่ยนแปลงใดๆ บน Calendar
 */
function onCalendarUpdate(e) {
  const props = PropertiesService.getScriptProperties();
  let syncToken = props.getProperty('CALENDAR_SYNC_TOKEN');
  
  const cache = CacheService.getScriptCache();
  if (!cache.get('triggers_cleaned')) {
    removeDuplicateTriggers();
    cache.put('triggers_cleaned', '1', 3600);
  }
  
  let options = { maxResults: 100 };
  if (syncToken) {
    options.syncToken = syncToken;
  } else {
    // ถ้าเพิ่งรันครั้งแรก ให้ดึงเฉพาะข้อมูลตั้งแต่ 1 วันที่แล้ว เพื่อลดภาระ
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    now.setDate(now.getDate() - 1);
    options.timeMin = now.toISOString();
  }

  let items = [];
  let nextSyncToken = null;
  let pageToken = null;

  try {
    do {
      if (pageToken) options.pageToken = pageToken;
      const eventsList = Calendar.Events.list(CALENDAR_ID, options);
      
      if (eventsList.items && eventsList.items.length > 0) {
        items = items.concat(eventsList.items);
      }
      pageToken = eventsList.nextPageToken;
      nextSyncToken = eventsList.nextSyncToken;
    } while (pageToken);
  } catch (err) {
    if (err.message && err.message.includes('Sync token is no longer valid')) {
      props.deleteProperty('CALENDAR_SYNC_TOKEN');
      Logger.log('Sync token expired. Resetting.');
      return;
    }
    Logger.log('Error fetching events: ' + err.toString());
    return;
  }

  // เก็บ syncToken ใหม่สำหรับรอบถัดไป
  if (nextSyncToken) {
    props.setProperty('CALENDAR_SYNC_TOKEN', nextSyncToken);
  }

  // ถ้ารันครั้งแรก ไม่ต้องส่งแจ้งเตือนสิ่งที่มีอยู่แล้ว
  if (!syncToken) return;

  if (items.length === 0) return;

  // วนลูปตรวจสอบสิ่งที่เปลี่ยนไป
  items.forEach(item => {
    // กรอง event ที่เป็นของบอทสร้างขึ้นชั่วคราว
    if (item.summary && item.summary.includes('Test Authorization')) return;

    const eventId = item.id;
    if (!eventId) return;

    // ตรวจสอบ debounce: ถ้า event นี้เพิ่งส่งแจ้งเตือนไปเมื่อไม่เกิน 15 วินาทีที่แล้ว ให้ข้ามทันที
    const dedupeKey = 'notif_event_' + eventId;
    if (cache.get(dedupeKey)) {
      Logger.log('⏭️ ข้ามการแจ้งเตือนซ้ำของ event: ' + eventId + ' (' + item.summary + ')');
      return;
    }
    cache.put(dedupeKey, '1', 15);

    const status = item.status;
    let actionType = '';
    let color = 0;
    
    if (status === 'cancelled') {
      actionType = '🗑️ ลบงาน';
      color = 0xEA4335; // Red
      sendDiscord(null, [{
        title: actionType,
        description: `**ID:** \`${item.id}\` ถูกลบออกจากปฏิทินแล้ว`,
        color: color,
        footer: { text: BOT_NAME },
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    const createdDate = item.created ? new Date(item.created) : new Date(0);
    const updatedDate = item.updated ? new Date(item.updated) : new Date(0);
    
    // ถ้ามีคำว่า "เสร็จแล้ว" ให้แจ้งเตือนว่างานเสร็จ
    const diffTime = Math.abs(updatedDate.getTime() - createdDate.getTime());
    if (item.summary && item.summary.includes('เสร็จแล้ว')) {
      actionType = '🎉 งานเสร็จแล้ว';
      color = 0x8E24AA; // Purple
    }
    // ถ้าถูกสร้างและอัปเดตห่างกันไม่เกิน 60 วินาที ให้ถือว่าเพิ่มใหม่
    else if (diffTime < 60000) {
      actionType = '✅ เพิ่มงานใหม่';
      color = 0x34A853; // Green
    } else {
      actionType = '✏️ แก้ไขงาน';
      color = 0xFBBC04; // Yellow
    }

    let timeInfo = '';
    if (item.start && item.start.dateTime) {
      const start = new Date(item.start.dateTime);
      const end = new Date(item.end.dateTime);
      timeInfo = `**วันที่:** ${thaiDate(start)}\n**เวลา:** ${thaiTime(start)} - ${thaiTime(end)}`;
    } else if (item.start && item.start.date) {
      const start = new Date(item.start.date);
      timeInfo = `**วันที่:** ${thaiDate(start)}\n**เวลา:** ทั้งวัน`;
    } else {
      timeInfo = `*ไม่ได้ระบุเวลา*`;
    }
    
    const loc = item.location ? `\n**สถานที่:** ${item.location}` : '';
    const desc = item.description ? `\n**รายละเอียด:** ${item.description.substring(0, 150)}...` : '';

    sendDiscord(null, [{
      title: actionType,
      description: `**ชื่องาน:** ${item.summary || '(ไม่มีชื่อ)'}\n\n${timeInfo}${loc}${desc}`,
      color: color,
      footer: { text: BOT_NAME },
      timestamp: new Date().toISOString()
    }]);
  });
}

