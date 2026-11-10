function testGetEvents() {
  var monday = new Date(2026, 5, 29); // June 29
  var sunday = new Date(2026, 6, 5, 23, 59, 59); // July 5
  var events = CalendarApp.getCalendarById('58a156ffae5a210dff9a4632db2fefbb8d08cbb940b52dd0c550c67ecba55e97@group.calendar.google.com').getEvents(monday, sunday);
  Logger.log('Total: ' + events.length);
  for(var i=0; i<events.length; i++) {
    Logger.log(events[i].getTitle() + ' | ' + events[i].getStartTime() + ' | ' + events[i].getEndTime());
  }
}
