import Foundation
@main struct CheckLinks {
 static func main() {
  for text in ["https://www.google.com/calendar/event?eid=fixture","https://calendar.google.com/calendar/u/0/r/eventedit?eid=fixture","https://accounts.google.com/o/oauth2/v2/auth","https://meet.google.com/aaa-bbbb-ccc"] { precondition(DesktopLinks.allowsGoogleCalendar(URL(string:text)!)) }
  for text in ["http://www.google.com/calendar/event","https://www.google.com/url?q=bad","https://www.google.com/calendar/../url","https://google.com.evil.test/calendar/event","https://user:secret@calendar.google.com/","https://calendar.google.com:8443/"] { precondition(!DesktopLinks.allowsGoogleCalendar(URL(string:text)!)) }
  for text in ["https://example.com/notes?week=2","http://example.com/room","https://www.google.com/calendar/event?eid=fixture"] { precondition(DesktopLinks.allowsCalendarDetail(URL(string:text)!)) }
  for text in ["file:///etc/passwd","javascript:alert(1)","mailto:someone@example.com","https://user:secret@example.com/","broccoli://settings"] { precondition(!DesktopLinks.allowsCalendarDetail(URL(string:text)!)) }
  print("18 native Google Calendar and user-clicked detail link scenarios passed")
 }
}
