import Foundation

/// Calendar's own htmlLink can use Google's legacy www.google.com/calendar
/// endpoint. Keep that link intact while excluding unrelated Google redirects.
enum DesktopLinks {
    static func allowsCalendarDetail(_ url:URL) -> Bool {
        return ["https","http"].contains(url.scheme?.lowercased() ?? "") &&
            url.host?.isEmpty == false && url.user == nil && url.password == nil
    }
    static func allowsGoogleCalendar(_ url:URL) -> Bool {
        guard url.scheme=="https",url.user==nil,url.password==nil,url.port==nil else{return false}
        if ["accounts.google.com","calendar.google.com","meet.google.com","console.cloud.google.com","developers.google.com"].contains(url.host ?? ""){return true}
        return url.host=="www.google.com" && (url.path=="/calendar" || url.path.hasPrefix("/calendar/")) && !url.pathComponents.contains("..")
    }
}
