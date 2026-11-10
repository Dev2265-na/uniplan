// ============================================================
//  Discord.gs — Slash Commands + Modal Integration
//  CalendArt Discord Bot
// ============================================================

// ── Discord Interaction Endpoint ────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.type === 1) return respond({ type: 1 });           // PING
    if (body.type === 2) return handleCommand(body);            // Slash command
    if (body.type === 5) return handleModalSubmit(body);        // Modal submit

    return respond({ type: 4, data: { content: '❓ Unknown interaction type' } });
  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    return respond({ type: 4, data: { content: '❌ Internal error: ' + err.message } });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Slash Command Router ─────────────────────────────────────
function handleCommand(interaction) {
  const name = interaction.data.name;
  switch (name) {
    case 'add-event': return showAddEventModal();
    case 'today':     return cmdToday();
    case 'week':      return cmdWeek();
    default:
      return respond({ type: 4, data: { content: `❌ ไม่รู้จักคำสั่ง \`/${name}\`` } });
  }
}

// ── /add-event → เปิด Modal ──────────────────────────────────
function showAddEventModal() {
  return respond({
    type: 9,   // MODAL
    data: {
      title    : '📅 เพิ่มงานใหม่',
      custom_id: 'add_event_modal',
      components: [
        {
          type: 1,
          components: [{
            type       : 4,
            custom_id  : 'title',
            style      : 1,        // SHORT
            label      : 'ชื่องาน',
            placeholder: 'เช่น ประชุมทีม, ส่งงาน Project',
            required   : true,
            max_length : 100
          }]
        },
        {
          type: 1,
          components: [{
            type       : 4,
            custom_id  : 'date',
            style      : 1,
            label      : 'วันที่',
            placeholder: 'เช่น 2025-12-25 หรือ 25/12/2025',
            required   : true
          }]
        },
        {
          type: 1,
          components: [{
            type       : 4,
            custom_id  : 'time',
            style      : 1,
            label      : 'เวลาเริ่มต้น',
            placeholder: 'เช่น 09:00 หรือ 14:30',
            required   : true
          }]
        },
        {
          type: 1,
          components: [{
            type       : 4,
            custom_id  : 'duration',
            style      : 1,
            label      : 'ระยะเวลา (นาที) — ไม่กรอกใช้ค่าเริ่มต้น 60',
            placeholder: 'เช่น 30, 60, 90, 120',
            required   : false,
            value      : '60'
          }]
        },
        {
          type: 1,
          components: [{
            type       : 4,
            custom_id  : 'description',
            style      : 2,        // PARAGRAPH
            label      : 'รายละเอียด (ไม่บังคับ)',
            placeholder: 'รายละเอียดเพิ่มเติม สถานที่ หรือโน้ต...',
            required   : false,
            max_length : 500
          }]
        }
      ]
    }
  });
}

// ── Modal Submit Handler ─────────────────────────────────────
function handleModalSubmit(interaction) {
  if (interaction.data.custom_id !== 'add_event_modal') {
    return respond({ type: 4, data: { content: '❓ Unknown modal' } });
  }

  // ดึงค่าจาก Modal components
  const values = {};
  interaction.data.components.forEach(function(row) {
    row.components.forEach(function(comp) {
      values[comp.custom_id] = comp.value || '';
    });
  });

  return processAddEvent(values);
}

// ── Create Calendar Event ────────────────────────────────────
function processAddEvent(opts) {
  try {
    const title    = (opts['title']       || '').trim();
    const dateStr  = (opts['date']        || '').trim();
    const timeStr  = (opts['time']        || '').trim();
    const duration = Number(opts['duration'] || 60) || 60;
    const desc     = (opts['description'] || '').trim();

    if (!title)   throw new Error('กรุณากรอกชื่องาน');
    if (!dateStr) throw new Error('กรุณากรอกวันที่');
    if (!timeStr) throw new Error('กรุณากรอกเวลา');

    // Parse date (รองรับ YYYY-MM-DD และ DD/MM/YYYY)
    let year, month, day;
    if (dateStr.includes('-')) {
      [year, month, day] = dateStr.split('-').map(Number);
    } else if (dateStr.includes('/')) {
      const parts = dateStr.split('/').map(Number);
      if (parts[2] > 31) { [day, month, year] = parts; }   // DD/MM/YYYY
      else               { [year, month, day] = parts; }   // YYYY/MM/DD
    } else {
      throw new Error('รูปแบบวันที่ไม่ถูกต้อง ใช้ YYYY-MM-DD หรือ DD/MM/YYYY');
    }

    // Parse time
    const timeParts = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeParts) throw new Error('รูปแบบเวลาไม่ถูกต้อง ใช้ HH:MM เช่น 09:30');

    const start = new Date(year, month - 1, day, Number(timeParts[1]), Number(timeParts[2]), 0);
    const end   = new Date(start.getTime() + duration * 60 * 1000);

    CalendarApp.getCalendarById(CALENDAR_ID).createEvent(title, start, end, { description: desc });

    const fields = [
      { name: '📌 ชื่องาน', value: title,                                   inline: false },
      { name: '📅 วันที่',  value: thaiDate(start),                          inline: true  },
      { name: '⏰ เวลา',    value: `${thaiTime(start)} – ${thaiTime(end)}`, inline: true  }
    ];
    if (desc) fields.push({ name: '📝 รายละเอียด', value: desc, inline: false });

    return respond({
      type: 4,
      data: {
        embeds: [{
          title    : '✅ เพิ่มงานสำเร็จ!',
          color    : 0x34A853,
          fields   : fields,
          footer   : { text: BOT_NAME },
          timestamp: new Date().toISOString()
        }]
      }
    });
  } catch (err) {
    return respond({ type: 4, data: { content: `❌ **Error:** ${err.message}` } });
  }
}

// ── /today ───────────────────────────────────────────────────
function cmdToday() {
  const now            = new Date();
  const { start, end } = dayRange(now);
  const events         = getEvents(start, end);

  return respond({
    type: 4,
    data: {
      embeds: [{
        title    : `📅 กำหนดการวันนี้ — ${thaiDate(now)}`,
        color    : COLOR_DAILY,
        fields   : buildDayFields(events),
        footer   : { text: `${BOT_NAME} • ${events.length} รายการ` },
        timestamp: new Date().toISOString()
      }]
    }
  });
}

// ── /week ────────────────────────────────────────────────────
function cmdWeek() {
  const now    = new Date();
  const dayIdx = parseInt(Utilities.formatDate(now, TIMEZONE, 'u'), 10);
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayIdx - 1));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const allEvents = getEvents(monday, sunday);
  const fields    = [];

  for (let i = 0; i < 7; i++) {
    const day   = new Date(monday);
    day.setDate(monday.getDate() + i);
    const { start: ds, end: de } = dayRange(day);
    const dayEv = allEvents.filter(ev => {
      const tStart = ev.getStartTime().getTime();
      const tEnd = ev.getEndTime().getTime();
      const dStart = ds.getTime();
      const dEnd = de.getTime();
      return (tStart <= dEnd && tEnd > dStart) || (tStart === tEnd && tStart >= dStart && tStart <= dEnd);
    });
    const label = `${DAY_NAMES[day.getDay()]}  ${Utilities.formatDate(day, TIMEZONE, 'd/M')}`;

    if (!dayEv.length) {
      fields.push({ name: label, value: '_ไม่มีกำหนดการ_', inline: true });
    } else {
      const lines = dayEv.map(ev =>
        `• \`${ev.isAllDayEvent() ? 'ทั้งวัน' : thaiTime(ev.getStartTime())}\` ${ev.getTitle()}`
      ).join('\n');
      fields.push({ name: `${label}  (${dayEv.length})`, value: lines, inline: true });
    }
    if ((i + 1) % 2 === 0 && i < 6) fields.push({ name: '\u200B', value: '\u200B', inline: true });
  }

  return respond({
    type: 4,
    data: {
      embeds: [{
        title    : `🗓️ กำหนดการสัปดาห์ — ${Utilities.formatDate(monday, TIMEZONE, 'd/M/yyyy')} ถึง ${Utilities.formatDate(sunday, TIMEZONE, 'd/M/yyyy')}`,
        color    : COLOR_WEEKLY,
        fields   : fields,
        footer   : { text: `${BOT_NAME} • รวม ${allEvents.length} รายการ` },
        timestamp: new Date().toISOString()
      }]
    }
  });
}

// ── Register Slash Commands ──────────────────────────────────
function registerSlashCommands() {
  const props    = PropertiesService.getScriptProperties();
  const appId    = props.getProperty('DISCORD_APP_ID');
  const botToken = props.getProperty('DISCORD_BOT_TOKEN');

  if (!appId || !botToken) {
    Logger.log('❌ กรุณาตั้งค่า DISCORD_APP_ID และ DISCORD_BOT_TOKEN ใน Script Properties');
    return;
  }

  // /add-event ไม่มี options แล้ว — Modal จัดการแทน
  const commands = [
    { name: 'add-event', description: 'เพิ่มงานลงใน Google Calendar 📅 (จะมี pop-up ขึ้นมา)' },
    { name: 'today',     description: 'ดูกำหนดการวันนี้ทั้งหมด 📋' },
    { name: 'week',      description: 'ดูกำหนดการสัปดาห์นี้ทั้งหมด 🗓️' }
  ];

  const res = UrlFetchApp.fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method            : 'put',
    contentType       : 'application/json',
    headers           : { Authorization: `Bot ${botToken}` },
    payload           : JSON.stringify(commands),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  Logger.log(code === 200 ? '✅ Commands registered!' : `❌ Error ${code}: ${res.getContentText()}`);
}
