import AppKit

// Use the installed desktop's existing notification identity and permission.
// Starting it with --login keeps the window closed and preserves its signature.
let data = FileHandle.standardInput.readDataToEndOfFile()
guard data.count <= 4096,
      let value = try? JSONSerialization.jsonObject(with:data) as? [String:Any],
      let body = value["body"] as? String, !body.isEmpty, body.count <= 500 else { exit(2) }
let identifier = "local.hotturkey.desktop"
let candidates = [FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Broccoli.app"), URL(fileURLWithPath:"/Applications/Broccoli.app")]
guard let url = candidates.first(where:{ Bundle(url:$0)?.bundleIdentifier == identifier }) else { exit(3) }
var application = NSRunningApplication.runningApplications(withBundleIdentifier:identifier).first(where:{ $0.bundleURL?.standardizedFileURL == url.standardizedFileURL })
if application == nil {
    let config = NSWorkspace.OpenConfiguration()
    config.activates = false
    config.arguments = ["--login"]
    config.allowsRunningApplicationSubstitution = false
    let ready = DispatchSemaphore(value:0)
    NSWorkspace.shared.openApplication(at:url,configuration:config) { app,_ in application=app;ready.signal() }
    if ready.wait(timeout:.now()+10) == .timedOut { exit(4) }
}
let deadline = Date(timeIntervalSinceNow:3)
while application?.isFinishedLaunching == false && Date() < deadline {
    RunLoop.current.run(until:Date(timeIntervalSinceNow:0.05))
}
guard application?.isFinishedLaunching == true, application?.isTerminated == false else { exit(5) }
DistributedNotificationCenter.default().postNotificationName(NSNotification.Name("local.hotturkey.notice"),object:body,userInfo:nil,deliverImmediately:true)
