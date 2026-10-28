import AppKit
import WebKit
import Darwin

// Windowed presentation QA only. The Python driver supplies a temporary
// backend with enforcement disabled and no executable runtime in this bundle.
final class InterfaceQA {
 let delegate: Delegate
 let draftName="Native Sheet QA \(UUID().uuidString.prefix(8))"
 let root = URL(fileURLWithPath:CommandLine.arguments[1])
 var phase=0, busy=false, ticks=0, previousPhase = -1
 var confirmation:Bool?
 var originalPanel:NSWindow?
 var checks:[String:Bool]=[:]
 var pageIndex=0
 let pages=["overview","blocks","schedule","statistics","settings"]
 static let statusContrast = #"""
 (()=>{
  const rgba=text=>{const n=text.match(/[\d.]+/g)?.map(Number);return n&&n.length>=3?[...n.slice(0,3),n[3]??1]:null;};
  const blend=(top,bottom)=>top.slice(0,3).map((v,i)=>v*top[3]+bottom[i]*(1-top[3]));
  const light=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
  const results=[...document.querySelectorAll('.tag.green,.tag.orange')].map(tag=>{
   const style=getComputedStyle(tag),parent=getComputedStyle(tag.closest('.card'));
   const panel=rgba(parent.backgroundColor),fill=rgba(style.backgroundColor),ink=rgba(style.color);
   if(!panel||!fill||!ink)return false;
   const bg=blend(fill,panel),fg=blend(ink,bg),a=light(bg),b=light(fg);
   return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),ink:style.color,fill:style.backgroundColor,panel:parent.backgroundColor};
  });
  window.__interfaceContrast=results;
  return results.every(value=>value&&value.ratio>=4.5);
 })()
 """#
 var darkPages=false
 var largePages=false
 init(_ delegate:Delegate) { self.delegate=delegate }
 func require(_ condition:Bool,_ message:String) {
  if !condition { finish(message) }
 }
 func snapshot(_ name:String,_ completion:@escaping()->Void) {
  delegate.web.takeSnapshot(with:nil){image,error in
   guard let image,let data=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]) else{self.finish("Snapshot failed: \(name)");return}
   do {try png.write(to:self.root.appendingPathComponent("build/\(name).png"))} catch {self.finish("Could not save snapshot");return}
   completion()
  }
 }
 func menu(_ action:Selector)->NSMenuItem? {
  NSApp.mainMenu?.items.compactMap(\.submenu).flatMap(\.items).first{$0.action==action}
 }
 func invoke(_ item:NSMenuItem) {
  require(delegate.validateMenuItem(item),"Menu command unexpectedly disabled")
  require(NSApp.sendAction(item.action!,to:item.target,from:item),"Menu command failed")
 }
 func finish(_ error:String?=nil) {
  let failure=error ?? (checks.values.contains(false) ? "Failed checks: \(checks.filter{!$0.value}.keys.sorted())" : nil)
  var value:[String:Any] = ["passed":failure == nil,"checks":checks,"enforcement":false,"formal_data_changed":false,"physical_sleep_invoked":false]
  if let failure {value["error"]=failure}
  if let data=try? JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys]) {try? data.write(to:root.appendingPathComponent("build/native-sheet-proof.json"))}
  delegate.appearance.cancelEditor(); NSApp.terminate(nil)
 }
 func js(_ script:String,_ completion:@escaping(Any?)->Void) {
  busy=true
  delegate.web.evaluateJavaScript(script.replacingOccurrences(of:"Native Sheet QA",with:draftName)) { value,error in
   self.busy=false
   if let error {self.finish("phase \(self.phase): \(error.localizedDescription) \((error as NSError).userInfo)");return}
   completion(value)
  }
 }
 func tick() {
  ticks += 1
  if previousPhase != phase {previousPhase=phase;try? "phase \(phase)".write(to:root.appendingPathComponent("build/native-sheet-phase.txt"),atomically:true,encoding:.utf8)}
  if ticks>800 {finish("Native interface QA exceeded 80 seconds at phase \(phase)");return}
  if busy {return}
  let d=delegate
  switch phase {
  case 0:
   guard d.navigationFinished && d.nativeChromeInstalled else {return}
   js("Boolean(document.querySelector('#header-actions [data-action=new]'))") {value in
    if value as? Bool == true { self.phase=1;self.js("api('settings',{text_scale:100,theme:'light'}).then(()=>refresh(false)).then(()=>document.querySelector('#header-actions [data-action=new]').click());true") {_ in} }
   }
  case 1:
   guard let panel=d.window.attachedSheet,d.web.window === panel else{return}
   checks["real_appkit_sheet"]=panel is NSPanel;originalPanel=panel
   if let item=menu(#selector(Delegate.createRule(_:))) {
    checks["new_disabled_during_sheet"] = !d.validateMenuItem(item)
   }
   checks["bounded_geometry"]=panel.frame.width<=d.window.frame.width && panel.frame.height<=d.window.frame.height
   phase=2
   js("JSON.stringify({sheet:document.documentElement.classList.contains('native-sheet'),focused:document.activeElement.id})") { value in
    guard let s=value as? String,s.contains("true"),s.contains("editor-name") else{self.finish("Editor initial focus incorrect: \(value ?? "nil")");return}
    self.checks["editor_name_focused"]=true
    self.js("document.querySelector('#editor-name').value='Native Sheet QA';document.querySelector('[name=websites]').value='native-sheet.invalid';document.querySelector('[data-tab=applications]').click();document.querySelector('[data-tab=websites]').click()") {_ in}
   }
  case 2:
   phase=3
   js("document.querySelector('#editor-name').value==='Native Sheet QA'&&document.querySelector('[name=websites]').value==='native-sheet.invalid'") {value in
    guard value as? Bool == true,self.originalPanel === d.window.attachedSheet else{self.finish("Tab switch lost draft or sheet identity");return}
    self.checks["draft_retained_across_tabs"]=true
    d.web.evaluateJavaScript("confirm('Native sheet QA')") {value,error in
     self.confirmation=value as? Bool
    }
   }
  case 3:
   guard let child=originalPanel?.attachedSheet else{return}
   checks["confirmation_attached_to_editor"]=true
   originalPanel?.endSheet(child,returnCode:.alertSecondButtonReturn);phase=4
  case 4:
   guard confirmation == false else{return}
   checks["confirmation_cancelled"]=true;phase=5
   js("window.webkit.messageHandlers.native.postMessage('pickApp'); true") {_ in}
  case 5:
   guard let panel=originalPanel?.attachedSheet as? NSOpenPanel else{return}
   checks["file_picker_attached_to_editor"]=true
   panel.cancel(nil);phase=6
  case 6:
   guard originalPanel?.attachedSheet == nil else{return}
   phase=7;js("document.querySelector('[data-action=save-editor]').click()") {_ in}
  case 7:
   if d.window.attachedSheet != nil {
    if ticks % 10 == 0 {js("JSON.stringify({error:document.querySelector('#modal-error')?.textContent,open:document.querySelector('#modal').open,name:document.querySelector('#editor-name')?.value})") {value in
     if let value=value as? String {try? value.write(to:self.root.appendingPathComponent("build/native-sheet-save-debug.json"),atomically:true,encoding:.utf8)}
    }}
    return
   }
   guard d.web.window === d.window else{return}
   checks["save_restores_main_webview"]=true
   phase=8;js("document.querySelector('nav [data-page=blocks]').click()") {_ in}
  case 8:
   js("document.querySelector('#content').textContent.includes('Native Sheet QA')&&!document.documentElement.classList.contains('native-sheet')") {value in
    guard value as? Bool == true else{return}
    self.checks["inactive_rule_saved"]=true;self.phase=9
    self.js("document.querySelector('#header-actions [data-action=new]').click()") {_ in}
   }
  case 9:
   guard let panel=d.window.attachedSheet else{return}
   phase=10;panel.performClose(nil)
  case 10:
   guard d.window.attachedSheet == nil,d.web.window === d.window else{return}
   checks["native_close_restores_main_webview"]=true
   phase=11;js("api('settings',{text_scale:200,theme:'dark'}).then(()=>refresh(false)).then(()=>document.querySelector('#header-actions [data-action=new]').click()); true") {_ in}
  case 11:
   guard let panel=d.window.attachedSheet,d.web.window === panel else{return}
   checks["large_text_sheet_bounded"]=panel.frame.width<=d.window.frame.width && panel.frame.height<=d.window.frame.height
   phase=12;busy=true
   DispatchQueue.main.asyncAfter(deadline:.now()+0.35) {
   self.js("(()=>{const r=document.querySelector('.modal-footer').getBoundingClientRect();return JSON.stringify({ok:document.body.style.zoom==='2'&&r.top>=0&&r.bottom<=innerHeight+2&&r.right<=innerWidth+2,rect:r.toJSON(),width:innerWidth,height:innerHeight,zoom:document.body.style.zoom,uih:getComputedStyle(document.documentElement).getPropertyValue('--ui-height')})})()") {value in
    guard let metrics=value as? String,metrics.contains("\"ok\":true") else{self.finish("Large text footer clipped: \(value ?? "nil")");return}
    self.checks["large_text_actions_visible"]=true
    d.web.takeSnapshot(with:nil){image,error in
     if let image,let data=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]) {try? png.write(to:self.root.appendingPathComponent("build/Native-sheet-editor-200.png"))}
     panel.performClose(nil)
    }
   }
   }
  case 12:
   guard d.window.attachedSheet == nil,d.web.window === d.window else{return}
   phase=13
   js("api('settings',{text_scale:100,theme:'light'}).then(()=>refresh(false)).then(()=>lockModal(state.blocks.find(b=>b.name==='Native Sheet QA').id));true") {_ in}
  case 13:
   guard let panel=d.window.attachedSheet,d.web.window === panel else{return}
   checks["compact_lock_sheet"]=abs(panel.frame.width-480)<2
   phase=14;busy=true
   DispatchQueue.main.asyncAfter(deadline:.now()+0.35) {
    self.js("(()=>{const expected={none:null,timer:'#lock-until',password:'#lock-password',text:'#lock-custom',delay:'[name=lock-delay]',schedule:'[name=lock-before]',range:'#lock-start',restart:null};for(const [mode,selector] of Object.entries(expected)){const select=document.querySelector('#lock-type');select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));if(selector&&!document.querySelector(selector))return false;if(!document.querySelector('#lock-description').textContent)return false;}const select=document.querySelector('#lock-type');select.value='timer';select.dispatchEvent(new Event('change',{bubbles:true}));return true})()") {value in
     guard value as? Bool == true else{self.finish("Lock method fields unavailable");return}
     self.checks["all_eight_lock_methods_render"]=true
    }
   }
  case 14:
   guard let panel=d.window.attachedSheet else{return}
   phase=15;busy=true
   d.web.takeSnapshot(with:nil){image,error in
    if let image,let data=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]) {try? png.write(to:self.root.appendingPathComponent("build/Lock-sheet-light.png"))}
    self.busy=false;panel.performClose(nil)
   }
  case 15:
   guard d.window.attachedSheet == nil,d.web.window === d.window else{return}
   phase=16
   js("api('settings',{text_scale:200,theme:'dark'}).then(()=>refresh(false)).then(()=>lockModal(state.blocks.find(b=>b.name==='Native Sheet QA').id));true") {_ in}
  case 16:
   guard let panel=d.window.attachedSheet,d.web.window === panel else{return}
   phase=17;busy=true
   DispatchQueue.main.asyncAfter(deadline:.now()+0.35) {
    self.js("(()=>{const r=document.querySelector('.modal-footer').getBoundingClientRect();return document.body.style.zoom==='2'&&document.body.classList.contains('dark')&&r.bottom<=innerHeight+2&&r.right<=innerWidth+2})()") {value in
     guard value as? Bool == true else{self.finish("Lock sheet large text controls clipped");return}
     self.checks["lock_sheet_dark_large_text_controls_visible"]=true
     d.web.takeSnapshot(with:nil){image,error in
      if let image,let data=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]) {try? png.write(to:self.root.appendingPathComponent("build/Lock-sheet-dark-200.png"))}
      self.busy=false;panel.performClose(nil)
     }
    }
   }
  case 17:
   guard d.window.attachedSheet == nil,d.web.window === d.window else{return}
   checks["standard_services_and_window_menus"]=NSApp.servicesMenu != nil && NSApp.windowsMenu != nil
   guard let redo=menu(Selector(("redo:"))),redo.keyEquivalent=="z",redo.keyEquivalentModifierMask==[.command,.shift] else{finish("Redo shortcut missing");return}
   checks["standard_redo_shortcut"]=true
   phase=18
   js("api('settings',{theme:'light',text_scale:100}).then(()=>refresh(false));true") {_ in}
  case 18:
   js("document.body.dataset.appearance==='light'&&document.body.style.zoom==='1'&&document.body.dataset.nativePalette==='true'") {value in
    if value as? Bool == true {self.phase=19}
   }
  case 19:
   let expected=DesktopStyle.payload(appearance:d.window.effectiveAppearance,active:true)["colors"] as! [String:String]
   let json=String(data:try! JSONSerialization.data(withJSONObject:expected),encoding:.utf8)!
   phase=20
   js("Object.entries(\(json)).every(([key,value])=>document.body.style.getPropertyValue(key)===value)&&document.documentElement.classList.contains('native-symbols')") {value in
    guard value as? Bool == true else{self.finish("AppKit palette or SF Symbols did not reach page");return}
    self.checks[self.largePages ? "large_text_appkit_palette_and_symbols" : self.darkPages ? "dark_appkit_palette_and_symbols":"light_appkit_palette_and_symbols"]=true
   }
  case 20:
   guard pageIndex<pages.count else{
    if !darkPages {
     darkPages=true;pageIndex=0;phase=21
     js("api('settings',{theme:'dark'}).then(()=>refresh(false));true") {_ in}
    } else if !largePages {
     largePages=true;pageIndex=0;phase=22
     js("api('settings',{text_scale:200}).then(()=>refresh(false));true") {_ in}
    } else {
     phase=37
     js("api('settings',{text_scale:100}).then(()=>refresh(false));true") {_ in}
    }
    return
   }
   let page=pages[pageIndex]
   guard let item=NSApp.mainMenu?.items.compactMap(\.submenu).flatMap(\.items).first(where:{$0.action == #selector(Delegate.selectPage(_:)) && $0.representedObject as? String == page}) else{finish("Page menu missing");return}
   invoke(item);busy=true
   let calendarCheck=page=="schedule" ? "[...document.querySelectorAll('.calendar-event')].length>0&&[...document.querySelectorAll('.calendar-event')].every(el=>el.tagName==='BUTTON'&&el.tabIndex===0&&getComputedStyle(el).opacity==='1'&&el.querySelector('b').getBoundingClientRect().top<=el.getBoundingClientRect().top+16)" : "true"
   DispatchQueue.main.asyncAfter(deadline:.now()+0.4){
    self.js("document.body.dataset.view==='\(page)'&&document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('#content input,#content select,#content button')].filter(el=>el.getBoundingClientRect().width&&!el.closest('.schedule-scroller')).every(el=>{const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1})&&(\(calendarCheck))&&[...document.querySelectorAll('#content input,#content select,#content textarea')].filter(el=>el.getBoundingClientRect().width).every(el=>el.getAttribute('aria-label')?.trim()||[...el.labels||[]].some(label=>label.textContent.trim()))") {value in
     guard value as? Bool == true else{self.finish("Page controls clipped: \(page)");return}
     self.checks["\(page)_\(self.darkPages ? "dark":"light")\(self.largePages ? "_200":"")_layout"]=true
     if page=="schedule" {self.checks["calendar_events_readable_and_keyboard_focusable"]=true}
     self.checks["\(page)_\(self.darkPages ? "dark":"light")\(self.largePages ? "_200":"")_input_labels"]=true
     self.js(Self.statusContrast){value in
      guard value as? Bool == true else{
       self.js("JSON.stringify(window.__interfaceContrast)"){value in self.finish("Status text contrast below 4.5:1: \(page): \(value ?? "nil")")};return
      }
      if page=="overview" {self.checks["status_text_\(self.darkPages ? "dark":"light")\(self.largePages ? "_200":"")_contrast"]=true}
      self.busy=true
      self.snapshot("Interface-\(page)-\(self.darkPages ? "dark":"light")\(self.largePages ? "-200":"")") {
       self.pageIndex+=1;self.busy=false
      }
     }
    }
   }
  case 21:
   js("document.body.dataset.appearance==='dark'&&document.body.classList.contains('dark')") {value in
    if value as? Bool == true {self.phase=19}
   }
  case 22:
   if d.appearance.textScale==200 {phase=19}
  case 37:
   if d.appearance.textScale==100 {phase=23}
  case 23:
   // Override only this page's presentation to exercise accessibility styles.
   // No system preference is changed, and the actual system values are restored.
   phase=24
   js("window.HotTurkeyAppearance.apply({reduceMotion:true,reduceTransparency:true,increaseContrast:true});document.querySelector('#content .panel')?.classList.add('qa-panel');true") {_ in}
  case 24:
   phase=25
   js("document.documentElement.classList.contains('reduce-motion')&&document.documentElement.classList.contains('reduce-transparency')&&getComputedStyle(document.querySelector('#toast')).backdropFilter==='none'&&getComputedStyle(document.querySelector('button')).transitionDuration==='0s'") {value in
    guard value as? Bool == true else{self.finish("Reduced motion/transparency styles missing");return}
    self.checks["synthetic_accessibility_styles"]=true
    let value=DesktopStyle.payload(appearance:d.window.effectiveAppearance,active:true)
    let json=String(data:try! JSONSerialization.data(withJSONObject:value),encoding:.utf8)!
    self.js("window.HotTurkeyAppearance.apply(\(json));true") {_ in}
   }
  case 25:
   guard let increase=NSApp.mainMenu?.items.compactMap(\.submenu).flatMap(\.items).first(where:{$0.action == #selector(Delegate.resizeText(_:)) && $0.representedObject as? String == "increase"}) else{finish("Zoom menu missing");return}
   invoke(increase);phase=26
  case 26:
   guard d.appearance.textScale==110 else{return}
   checks["menu_text_size_updates_immediately"]=true
   let reset=NSApp.mainMenu!.items.compactMap(\.submenu).flatMap(\.items).first{$0.action == #selector(Delegate.resizeText(_:)) && $0.representedObject as? String == "reset"}!
   invoke(reset);phase=27
  case 27:
   guard d.appearance.textScale==100,let create=menu(#selector(Delegate.createRule(_:))) else{return}
   invoke(create);phase=28
  case 28:
   guard let panel=d.window.attachedSheet,d.web.window===panel else{return}
   checks["new_menu_opens_editor_from_settings"]=true;phase=29
   js("document.querySelector('#editor-name').focus();document.execCommand('insertText',false,'Native menu text');true") {_ in}
  case 29:
   require(NSApp.sendAction(Selector(("undo:")),to:nil,from:nil),"Native Undo action unavailable")
   phase=30
  case 30:
   js("document.querySelector('#editor-name').value==='' ") {value in
    guard value as? Bool == true else{self.finish("Native Undo did not edit field");return}
    self.checks["native_undo_edits_web_field"]=true
    self.require(NSApp.sendAction(Selector(("redo:")),to:nil,from:nil),"Native Redo action unavailable")
    self.phase=31
   }
  case 31:
   js("document.querySelector('#editor-name').value==='Native menu text'") {value in
    guard value as? Bool == true else{self.finish("Native Redo did not restore field");return}
    self.checks["native_redo_edits_web_field"]=true;self.phase=32
    d.window.attachedSheet?.performClose(nil)
   }
  case 32:
   guard d.window.attachedSheet == nil,d.web.window===d.window else{return}
   phase=33
   js("api('settings',{text_scale:100,theme:'light'}).then(()=>refresh(false)).then(()=>lockModal(state.blocks.find(b=>b.locked).id));true") {_ in}
  case 33:
   guard d.window.attachedSheet != nil else{return}
   phase=34
   js("(()=>{if(!document.querySelector('#extend-until')||document.querySelector('#modal [data-action=unlock]'))return false;const original=state.blocks.find(b=>b.locked);const fixtures=[{type:'password'},{type:'text',text:'focus fixture',text_mode:'characters'},{type:'delay',minutes:2},{type:'range'},{type:'restart'},{type:'schedule'}];for(const lock of fixtures){lockedRuleModal({...original,id:'visual-state-only',lock,locked:true});const verify=['password','text','delay'].includes(lock.type);if(Boolean(document.querySelector('#modal [data-action=unlock]'))!==verify)return false;if(['password','text'].includes(lock.type)&&!document.querySelector('#unlock-answer'))return false;}lockModal(original.id);return true})()") {value in
    guard value as? Bool == true else{self.finish("Locked state form or available actions incorrect");return}
    self.checks["locked_state_forms_and_available_actions"]=true
    self.busy=true
    DispatchQueue.main.asyncAfter(deadline:.now()+0.35){
     self.snapshot("Locked-state-light") {
      self.busy=false;d.window.attachedSheet?.performClose(nil)
     }
    }
   }
  case 34:
   guard d.window.attachedSheet == nil,d.web.window===d.window else{return}
   phase=35
   js("api('settings',{theme:'system'}).then(()=>refresh(false));true") {_ in}
  case 35:
   guard d.window.appearance==nil else{return}
   checks["system_theme_clears_window_override"]=true
   finish()
  default:break
  }
 }
}
@main enum InterfaceFixture {
 static func main() {
  alarm(90)
  let app=NSApplication.shared,delegate=Delegate();let qa=InterfaceQA(delegate)
  app.setActivationPolicy(.regular);app.delegate=delegate
  DesktopMenu.install(delegate:delegate)
  let timer=Timer.scheduledTimer(withTimeInterval:0.1,repeats:true){_ in qa.tick()}
  withExtendedLifetime((timer,qa,delegate)){app.run()}
 }
}
