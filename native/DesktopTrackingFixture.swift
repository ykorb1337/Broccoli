import AppKit
import WebKit
import Darwin

@MainActor final class TrackingQA {
    let d: Delegate
    let root: URL
    var checks:[String:Bool]=[:]
    init(_ d:Delegate,root:String){self.d=d;self.root=URL(fileURLWithPath:root)}
    func fail(_ name:String)->NSError{NSError(domain:"HotTurkey.TrackingQA",code:1,userInfo:[NSLocalizedDescriptionKey:name])}
    func phase(_ text:String){
        let file=root.appendingPathComponent("build/native-tracking-progress.log")
        let value=(try? String(contentsOf:file,encoding:.utf8)) ?? ""
        try? (value+String(Date().timeIntervalSince1970)+" "+text+"\n").write(to:file,atomically:true,encoding:.utf8)
    }
    @discardableResult func js(_ body:String) async throws -> Any? {
        phase("JS begin "+String(body.prefix(140)))
        let result=try await d.web.callAsyncJavaScript(body,arguments:[:],in:nil,contentWorld:.page)
        phase("JS end");return result
    }
    func wait(_ name:String,timeout:TimeInterval=12,_ test:()->Bool) async throws {
        let end=Date().addingTimeInterval(timeout)
        while !test(){if Date()>end{throw fail(name)};try await Task.sleep(nanoseconds:50_000_000)}
    }
    func waitJS(_ expression:String) async throws {
        let end=Date().addingTimeInterval(12)
        while (try await js("return Boolean(\(expression));")) as? Bool != true {
            if Date()>end{let state=try? await js("return JSON.stringify({view:document.body.dataset.view,error:window.HotTurkeyTracking?.model.error,loading:window.HotTurkeyTracking?.model.loading,day:window.HotTurkeyTracking?.model.data?.day,shotMode:window.HotTurkeyTracking?.model.shotMode,shot:window.HotTurkeyTracking?.model.shot?.id,shotError:window.HotTurkeyTracking?.model.shotMessage});");throw fail("\(expression): \(state ?? "nil")")};try await Task.sleep(nanoseconds:60_000_000)
        }
    }
    func check(_ expression:String,_ name:String) async throws {guard (try await js("return Boolean(\(expression));")) as? Bool==true else{throw fail(name)};checks[name]=true}
    func capture(_ name:String) async throws {
        try await js("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));")
        let config=WKSnapshotConfiguration();config.afterScreenUpdates=true
        let image:NSImage=try await withCheckedThrowingContinuation{continuation in d.web.takeSnapshot(with:config){image,error in if let image{continuation.resume(returning:image)}else{continuation.resume(throwing:error ?? self.fail("Snapshot"))}}}
        guard let data=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:])else{throw fail("Image encode")}
        try png.write(to:root.appendingPathComponent("build/Tracking-\(name).png"))
    }
    func close() async throws {try await js("closeModal();");try await wait("Sheet did not close"){d.window.attachedSheet==nil&&d.web.window===d.window};try await waitJS("!document.documentElement.classList.contains('native-sheet')")}
    func panel() async throws {try await wait("Sheet did not appear"){d.window.attachedSheet != nil};NSApp.activate(ignoringOtherApps:true);d.window.attachedSheet?.makeKeyAndOrderFront(nil);try await wait("Editor did not draw"){!(d.window.attachedSheet?.contentView?.subviews.contains{$0.accessibilityIdentifier()=="HotTurkeyEditorRenderCover"} ?? true)}}
    func descendants(_ view:NSView)->[NSView] { view.subviews.flatMap{[$0]+descendants($0)} }
    func activateMain() async throws {
        phase("activate main begin active=\(NSApp.isActive) key=\(d.window.isKeyWindow)")
        if NSApp.isActive&&d.window.isKeyWindow {phase("main already active");return}
        if ProcessInfo.processInfo.environment["HT_QA_MANUAL_ACTIVATION"]=="1" {
            d.window.orderFront(nil)
            try await wait("Manual activation of the test window was not observed",timeout:90){NSApp.isActive&&self.d.window.isKeyWindow}
            phase("manual activation observed");return
        }
        d.show()
        try await wait("Main test window did not activate"){
            if NSApp.isActive&&self.d.window.isKeyWindow{return true}
            NSApp.activate(ignoringOtherApps:true);self.d.window.makeKeyAndOrderFront(nil)
            return false
        }
        phase("activate main complete")
    }
    func confirmExport(_ panel:NSSavePanel,parent:NSWindow,name:String) async throws -> URL {
        let destination=root.appendingPathComponent("build/"+name)
        panel.directoryURL=destination.deletingLastPathComponent();panel.nameFieldStringValue=destination.lastPathComponent
        NSApp.activate(ignoringOtherApps:true);panel.makeKeyAndOrderFront(nil)
        try await Task.sleep(nanoseconds:300_000_000)
        for type in [NSEvent.EventType.keyDown,.keyUp] {
            if let event=NSEvent.keyEvent(with:type,location:.zero,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:panel.windowNumber,context:nil,characters:"\r",charactersIgnoringModifiers:"\r",isARepeat:false,keyCode:36) {NSApp.postEvent(event,atStart:false)}
        }
        try await wait("Export was not written: "+name){FileManager.default.fileExists(atPath:destination.path)&&parent.attachedSheet==nil}
        return destination
    }
    func mediaChecks() async throws {
        // Keep a stationary physical pointer from generating hover events when
        // WebKit dismisses a dialog beneath it; these checks send their own moves.
        try await js("window.__qaPointerFilter=event=>{if(event.isTrusted)event.stopImmediatePropagation();};for(const type of ['pointermove','pointerout'])window.addEventListener(type,window.__qaPointerFilter,true);")
        func hover(_ timeline:String,_ index:Int=0) async throws {
            try await js("const node=document.querySelectorAll('.mt-activity[data-timeline=\(timeline)]')[\(index)];node.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=node.getBoundingClientRect();node.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));")
        }
        try await check("!document.querySelector('[data-mt=viewer]')&&!document.querySelector('.mt-viewer')", "screenshots_do_not_reserve_workspace_space")
        try await js("window.__beforeScreenshotSelection=JSON.stringify(window.HotTurkeyTracking.model.selection);window.__beforeScreenshotHeight=document.querySelector('.mt-data-grid').getBoundingClientRect().height;")
        try await hover("documents")
        try await Task.sleep(nanoseconds:200_000_000)
        try await check("!document.querySelector('#mt-shot-preview')", "document_bars_do_not_show_screenshot_popovers")
        try await hover("computer")
        try await waitJS("document.querySelector('#mt-shot-preview img')?.naturalWidth===32")
        try await check("window.HotTurkeyTracking.model.shot.id==='"+String(repeating:"a",count:32)+"'", "computer_usage_bar_shows_its_matching_screenshot")
        try await capture("screenshot-hover-light")
        try await js("document.querySelector('.mt-activity[data-timeline=computer]').dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}));")
        try await check("!document.querySelector('#mt-shot-preview')&&window.HotTurkeyTracking.model.shotMode==='idle'", "leaving_bar_hides_unpinned_screenshot")
        try await hover("applications")
        try await waitJS("document.querySelector('#mt-shot-preview img')?.naturalWidth===32")
        try await js("window.__previewURL=document.querySelector('#mt-shot-preview img').src;document.querySelector('.mt-activity[data-timeline=applications]').click();")
        try await waitJS("document.querySelector('#mt-shot-expanded')?.open")
        try await wait("Navigation remains enabled beneath enlarged screenshot"){!d.appearance.canNavigate}
        try await check("!document.querySelector('#mt-shot-preview')&&document.querySelector('#mt-shot-expanded img').src===window.__previewURL&&window.HotTurkeyTracking.model.shot.id==='"+String(repeating:"a",count:32)+"'", "click_enlarges_exact_displayed_frame_without_refetch")
        try await hover("applications",1)
        try await js("document.querySelector('#mt-shot-expanded').click();document.querySelector('#mt-shot-expanded').dispatchEvent(new Event('cancel',{cancelable:true}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));")
        try await check("document.querySelector('#mt-shot-expanded')?.open&&window.HotTurkeyTracking.model.shot.id==='"+String(repeating:"a",count:32)+"'", "enlarged_frame_stays_fixed_until_circular_close_button")
        try await capture("screenshot-expanded-light")
        try await js("document.querySelector('.mt-shot-close').click();")
        try await wait("Navigation did not return after screenshot closed"){d.appearance.canNavigate}
        try await check("!document.querySelector('#mt-shot-expanded')&&!document.querySelector('#mt-shot-preview')&&window.HotTurkeyTracking.model.shotMode==='idle'&&document.activeElement===document.querySelector('.mt-activity[data-timeline=applications]')", "circular_close_restores_timeline_focus_and_hover_mode")
        try await check("JSON.stringify(window.HotTurkeyTracking.model.selection)===window.__beforeScreenshotSelection&&Math.abs(document.querySelector('.mt-data-grid').getBoundingClientRect().height-window.__beforeScreenshotHeight)<1", "screenshot_preview_preserves_selection_and_workspace_layout")
        try await hover("applications",2)
        try await Task.sleep(nanoseconds:200_000_000)
        try await check("!document.querySelector('#mt-shot-preview')", "bar_without_screenshot_never_shows_frame_from_another_interval")
        for (profile,theme,scale) in [("dark","dark",100),("dark-200","dark",200)] {
            try await js("await api('settings',{theme:'\(theme)',text_scale:\(scale)});await refresh(false);await window.HotTurkeyTracking.refresh();")
            try await hover("applications")
            try await waitJS("document.querySelector('#mt-shot-preview img')?.naturalWidth===32")
            try await check("(()=>{const r=document.querySelector('#mt-shot-preview').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})()", "screenshot_hover_\(profile)_stays_inside_window")
            try await capture("screenshot-hover-"+profile)
            try await js("document.querySelector('.mt-activity[data-timeline=applications]').click();")
            try await waitJS("document.querySelector('#mt-shot-expanded')?.open")
            try await check("(()=>{const r=document.querySelector('#mt-shot-expanded').getBoundingClientRect(),c=document.querySelector('.mt-shot-close').getBoundingClientRect(),img=document.querySelector('#mt-shot-expanded img').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&c.width>=30&&c.height>=30&&c.left>=r.left&&c.top>=r.top&&img.left>=r.left&&img.right<=r.right+1&&img.bottom<=r.bottom+1;})()", "enlarged_screenshot_\(profile)_and_close_button_are_bounded")
            try await capture("screenshot-expanded-"+profile)
            try await js("document.querySelector('.mt-shot-close').click();")
        }
        try await js("await api('settings',{theme:'light',text_scale:100});await refresh(false);await window.HotTurkeyTracking.refresh();")
        try await hover("applications")
        try await waitJS("document.querySelector('#mt-shot-preview img')?.naturalWidth===32")
        try await js("document.querySelector('.mt-activity[data-timeline=applications]').click();await api('settings',{password:'screenshot-fixture-password'});await refresh(false);")
        try await check("!document.querySelector('#mt-shot-expanded')&&!document.querySelector('#mt-shot-preview')&&window.HotTurkeyTracking.model.shot===null&&window.HotTurkeyTracking.model.data===null", "management_lock_removes_all_private_screenshot_content")
        try await js("auth=(await api('auth',{password:'screenshot-fixture-password'})).session;await api('settings',{password:''});auth='';await refresh();")
        try await waitJS("window.HotTurkeyTracking.model.data&&!window.HotTurkeyTracking.model.loading")
        try await js("for(const type of ['pointermove','pointerout'])window.removeEventListener(type,window.__qaPointerFilter,true);delete window.__qaPointerFilter;")
    }
    func tagLibraryChecks() async throws {
        try await js("document.querySelector('[data-mt=add-tag]').click();")
        try await panel()
        try await js("document.querySelector('#mt-tag-notes').value='Retain hierarchy draft';document.querySelector('#mt-tag-billable').checked=true;document.querySelector('[data-mt=tag-picker]').click();")
        try await waitJS("[...document.querySelectorAll('[data-mt=tag-picker-child]')].some(v=>v.textContent.includes('项目'))")
        try await js("[...document.querySelectorAll('[data-mt=tag-picker-child]')].find(v=>v.textContent.includes('项目')).click();")
        try await waitJS("[...document.querySelectorAll('[data-mt=tag-picker-child]')].some(v=>v.textContent.includes('设计'))")
        try await js("[...document.querySelectorAll('[data-mt=tag-picker-child]')].find(v=>v.textContent.includes('设计')).click();")
        try await waitJS("document.querySelectorAll('[data-mt=tag-picker-up]').length===3")
        try await capture("tag-hierarchy-picker")
        try await js("document.querySelector('[data-mt=tag-picker-use]').click();")
        try await check("document.querySelector('#mt-tag-text').value==='项目, 设计'&&document.querySelector('#mt-tag-notes').value==='Retain hierarchy draft'&&document.querySelector('#mt-tag-billable').checked", "tag_hierarchy_picker_preserves_notes_and_billable_draft")
        try await waitJS("document.querySelectorAll('[data-mt=tag-recent]').length>0")
        try await check("[...document.querySelectorAll('[data-mt=tag-recent]')].some(v=>v.textContent.includes('$'))", "recent_tags_show_billable_metadata")
        try await close()
        try await js("document.querySelector('[data-mt=tag-manager]').click();")
        try await panel()
        try await waitJS("document.querySelectorAll('[data-mt=library-select]').length===2")
        try await js("[...document.querySelectorAll('[data-mt=library-select]')].find(v=>v.textContent.includes('项目')).click();document.querySelector('#mt-library-color-mode').value='fixed';document.querySelector('#mt-library-color-mode').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#mt-library-color').value='#ff9500';document.querySelector('[data-mt=library-save]').click();")
        try await waitJS("(await api('tracking/tag-library')).items.some(v=>v.name==='项目, 设计'&&v.color==='#ff9500')&&!window.HotTurkeyTracking.model.loading")
        try await check("(await api('tracking/day?day=2026-10-28')).activities.find(v=>v.tags?.includes('项目')).color==='#ff9500'", "combination_color_override_updates_day_timeline")
        try await js("document.querySelector('[data-mt=library-tab][data-value=tag]').click();")
        try await waitJS("document.querySelectorAll('[data-mt=library-select]').length===3")
        try await js("window.__realTagConfirm=window.confirm;window.confirm=()=>true;[...document.querySelectorAll('[data-mt=library-select]')].find(v=>v.textContent==='项目').click();document.querySelector('#mt-library-name').value='QA 项目';document.querySelector('#mt-library-color-mode').value='fixed';document.querySelector('#mt-library-color-mode').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#mt-library-color').value='#af52de';document.querySelector('#mt-library-skip').checked=true;document.querySelector('[data-mt=library-save]').click();")
        try await waitJS("(await api('tracking/tag-library?kind=tag')).items.some(v=>v.name==='QA 项目'&&v.skip)&&!window.HotTurkeyTracking.model.loading")
        try await check("(()=>{const v=window.HotTurkeyTracking.model.data.activities.find(v=>v.tags?.includes('QA 项目'));return v&&v.notes==='Native tracking fixture'&&v.billable&&v.end-v.start===3600;})()", "individual_tag_rename_preserves_history_notes_billable_and_time")
        try await js("document.querySelector('[data-mt=library-tab][data-value=combination]').click();")
        try await waitJS("[...document.querySelectorAll('[data-mt=library-select]')].some(v=>v.textContent.includes('QA 项目'))")
        try await js("[...document.querySelectorAll('[data-mt=library-select]')].find(v=>v.textContent.includes('QA 项目')).click();document.querySelector('#mt-library-color-mode').value='inherit';document.querySelector('#mt-library-color-mode').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-mt=library-save]').click();")
        try await waitJS("(await api('tracking/tag-library')).items.some(v=>v.name==='QA 项目, 设计'&&!v.color)&&!window.HotTurkeyTracking.model.loading")
        try await check("(await api('tracking/day?day=2026-10-28')).activities.find(v=>v.tags?.includes('QA 项目')).color===(await api('tracking/tag-library?kind=tag')).items.find(v=>v.name==='设计').resolved_color", "skip_inherited_color_uses_next_tag_color")
        try await js("document.querySelector('#mt-library-name').value='Unsaved library draft';document.querySelector('#mt-library-search').value='设计';document.querySelector('#mt-library-search').dispatchEvent(new Event('input',{bubbles:true}));")
        try await waitJS("document.querySelectorAll('[data-mt=library-select]').length===1")
        try await check("document.querySelector('#mt-library-name').value==='Unsaved library draft'", "library_search_retains_unsaved_editor_draft")
        try await js("window.confirm=()=>false;document.querySelector('[data-mt=library-new]').click();")
        try await check("document.querySelector('#mt-library-name').value==='Unsaved library draft'", "rejecting_library_draft_discard_retains_fields")
        try await js("window.confirm=window.__realTagConfirm;delete window.__realTagConfirm;")
        try await capture("tag-library-light")
        guard let editor=d.window.attachedSheet else{throw fail("Tag manager native sheet missing")}
        try await js("document.querySelector('[data-mt=library-export]').click();")
        try await wait("Tag library export panel missing"){editor.attachedSheet is NSSavePanel}
        guard let save=editor.attachedSheet as? NSSavePanel,save.nameFieldStringValue=="HotTurkey-tags.txt" else{throw fail("Wrong tag library export filename")}
        save.cancel(nil);try await wait("Tag library export did not cancel"){editor.attachedSheet==nil}
        try await check("document.querySelector('#mt-library-name').value==='Unsaved library draft'", "tag_library_export_cancel_preserves_editor_draft")
        try await close()
        try await check("!(await api('tracking/tag-library')).items.some(v=>v.name==='Unsaved library draft')", "cancelling_library_never_saves_uncommitted_name")
    }
    func run() async throws {
        phase("run begin")
        try await wait("App did not load"){d.nativeChromeInstalled&&d.navigationFinished}
        try await activateMain()
        d.appearance.showPage("statistics")
        try await waitJS("window.HotTurkeyTracking?.model.data&&!window.HotTurkeyTracking.model.loading")
        try await js("const input=document.querySelector('#mt-day');input.value='2026-10-28';input.dispatchEvent(new Event('change',{bubbles:true}));")
        try await waitJS("window.HotTurkeyTracking.model.data.day==='2026-10-28'&&!window.HotTurkeyTracking.model.loading")
        try await check("document.querySelectorAll('.mt-track').length===4&&document.querySelectorAll('.mt-data-pane').length===2&&document.querySelector('.mt-data-grid').getBoundingClientRect().top>document.querySelector('.mt-timeline-shell').getBoundingClientRect().top", "windows_timeline_above_details_and_summary")
        try await check("document.querySelector('.mt-summary-pane').getBoundingClientRect().left<document.querySelector('.mt-detail-pane').getBoundingClientRect().left", "summary_left_details_right_user_revision")
        try await check("window.HotTurkeyTracking.model.data.details.length===3&&window.HotTurkeyTracking.model.data.summary.length===3", "real_api_interval_rows_render")
        try await check("[...document.querySelectorAll('.mt-details th')].map(el=>el.querySelector('button')?.firstChild.textContent||el.textContent).join('|').includes('窗口标题|开始|结束|期间')", "detail_columns_match_windows_workflow")
        try await check("window.HotTurkeyTracking.model.range[1]-window.HotTurkeyTracking.model.range[0]<4*3600", "day_auto_fits_tracked_hours")
        try await capture("day-light")
        try await js("document.querySelector('.mt-activity[data-timeline=applications]').click();")
        try await waitJS("window.HotTurkeyTracking.model.data.totals.selected===3600&&!window.HotTurkeyTracking.model.loading")
        try await check("document.querySelectorAll('.mt-selection').length>=4&&window.HotTurkeyTracking.model.data.summary.some(v=>v.selected_seconds===3600)", "activity_selection_updates_all_tracks_and_summary")
        try await js("document.querySelector('[data-mt=settings]').click();")
        try await panel()
        d.window.attachedSheet?.cancelOperation(nil)
        try await wait("Native cancel did not close tracking settings"){d.window.attachedSheet==nil&&d.web.window===d.window}
        try await check("!modal.open", "native_escape_closes_tracking_sheet")
        try await waitJS("!document.documentElement.classList.contains('native-sheet')")
        try await js("document.querySelector('[data-mt=settings]').click();")
        try await panel()
        try await js("const enabled=document.querySelector('#mt-schedule-enabled');enabled.checked=true;enabled.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#mt-schedule-from').value='09:07';document.querySelector('#mt-schedule-to').value='10:03';document.querySelector('[data-mt=schedule-add]').click();")
        try await check("document.querySelectorAll('[data-mt-slot][data-selected=partial]').length===10&&document.querySelectorAll('[data-mt-slot][data-selected=true]').length===5", "schedule_grid_keeps_exact_minute_boundaries")
        try await capture("tracking-settings-record")
        try await js("document.querySelector('[data-mt=settings-tab][data-value=privacy]').click();document.querySelector('#mt-filter-application').value='\"Private Editor\"';document.querySelector('#mt-filter-website-mode').value='include';document.querySelector('#mt-filter-website').value='research.invalid';document.querySelector('#mt-filter-document').value='/private/';document.querySelector('#mt-filter-title').value='Confidential';")
        try await check("document.querySelector('#mt-settings-record').hidden&&!document.querySelector('#mt-settings-privacy').hidden&&document.querySelector('#mt-filter-title').value==='Confidential'", "tracking_settings_tabs_retain_drafts")
        try await capture("tracking-settings-privacy")
        try await js("document.querySelector('[data-mt=settings-tab][data-value=screenshots]').click();")
        try await check("document.querySelector('#mt-shot-scope').textContent.includes('前台应用')&&document.querySelector('#mt-shot-scope').textContent.includes('完整画面')", "screenshot_settings_explain_foreground_filter_and_full_display_capture")
        try await js("document.querySelector('#mt-filter-screenshot_application').value='Private';document.querySelector('#mt-image-format').value='png';document.querySelector('[data-mt=save-settings]').click();")
        try await wait("Settings did not close"){d.window.attachedSheet==nil}
        try await waitJS("!window.HotTurkeyTracking.model.loading&&window.HotTurkeyTracking.model.data.settings.schedule_enabled")
        try await check("(()=>{const s=window.HotTurkeyTracking.model.data.settings;return s.schedule.length===1&&s.schedule[0].start===547&&s.schedule[0].end===603&&s.schedule[0].days.length===5&&s.applications[0]==='\"Private Editor\"'&&s.website_mode==='include'&&s.websites[0]==='research.invalid'&&s.documents[0]==='/private/'&&s.window_titles[0]==='Confidential'&&!s.screenshots_enabled&&s.screenshot_format==='png';})()", "recording_schedule_and_all_privacy_filters_persist")
        try await js("document.querySelector('[data-mt=settings]').click();")
        try await panel()
        try await check("document.querySelector('#mt-schedule-enabled').checked&&document.querySelectorAll('[data-mt-slot][data-selected=partial]').length===10", "reopening_settings_restores_weekly_schedule")
        try await close()
        try await js("await api('tracking/settings',{schedule_enabled:false,application_mode:'exclude',applications:[],website_mode:'exclude',websites:[],documents:[],window_titles:[],screenshot_applications:[]});await window.HotTurkeyTracking.refresh();")
        try await js("document.querySelector('[data-mt=add-tag]').click();")
        try await panel()
        try await check("document.querySelector('#mt-tag-text')===document.activeElement", "tag_sheet_focus")
        try await js("document.querySelector('#mt-tag-text').value='项目, 设计';document.querySelector('#mt-tag-notes').value='Native tracking fixture';document.querySelector('#mt-tag-billable').checked=true;document.querySelector('[data-mt=save-tag]').click();")
        try await wait("Tag sheet did not close"){d.window.attachedSheet==nil}
        try await waitJS("window.HotTurkeyTracking.model.data.activities.some(v=>v.tags?.includes('项目'))&&!window.HotTurkeyTracking.model.loading")
        try await check("window.HotTurkeyTracking.model.data.activities.some(v=>v.tags?.includes('设计')&&v.billable&&v.notes==='Native tracking fixture')", "tag_time_notes_and_billable_persist")
        try await tagLibraryChecks()
        try await js("document.querySelector('#mt-query').value='title:Draft';document.querySelector('#mt-query').dispatchEvent(new Event('input',{bubbles:true}));")
        try await waitJS("window.HotTurkeyTracking.model.data.details.length===1&&!window.HotTurkeyTracking.model.loading")
        try await check("window.HotTurkeyTracking.model.data.summary.length===1", "filter_updates_details_and_summary")
        try await js("document.querySelector('#mt-query').value='';document.querySelector('#mt-query').dispatchEvent(new Event('input',{bubbles:true}));")
        try await waitJS("window.HotTurkeyTracking.model.data.details.length===3&&!window.HotTurkeyTracking.model.loading")
        try await js("document.querySelector('.mt-split').focus();document.querySelector('.mt-split').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));")
        try await check("window.HotTurkeyTracking.model.detailWidth===43", "splitter_keyboard_adjusts_width")
        try await js("document.querySelector('[data-mt=pause]').click();")
        try await panel();try await js("document.querySelector('[data-mt=set-pause][data-value=manual]').click();")
        try await wait("Pause panel did not close"){d.window.attachedSheet==nil}
        try await waitJS("window.HotTurkeyTracking.model.data.settings.enabled===false&&!window.HotTurkeyTracking.model.loading")
        try await check("(await api('state')).blocks.some(b=>b.locked&&b.enabled)", "pausing_tracking_keeps_blocking_and_locks")
        try await js("await api('tracking/pause',{mode:'resume'});await window.HotTurkeyTracking.refresh();")
        try await mediaChecks()
        try await js("document.querySelector('[data-mt=view][data-value=statistics]').click();")
        try await waitJS("window.HotTurkeyTracking.model.report?.series?.length===3&&!window.HotTurkeyTracking.model.loading")
        try await check("document.querySelectorAll('.mt-series').length===3", "top_report_uses_interval_data")
        try await js("document.querySelector('#mt-chart-style').value='line';document.querySelector('#mt-chart-style').dispatchEvent(new Event('change',{bubbles:true}));")
        try await waitJS("window.HotTurkeyTracking.model.report.chart_type==='line'&&!window.HotTurkeyTracking.model.loading")
        try await check("document.querySelectorAll('.mt-chart-line').length===3", "line_chart_uses_all_report_series")
        try await js("document.querySelector('#mt-show-average').checked=true;document.querySelector('#mt-show-average').dispatchEvent(new Event('change',{bubbles:true}));")
        try await waitJS("window.HotTurkeyTracking.model.report.show_average&&!window.HotTurkeyTracking.model.loading")
        try await check("document.querySelectorAll('.mt-chart-average').length===3&&window.HotTurkeyTracking.model.report.buckets.length===7", "average_lines_include_empty_dates")
        try await js("document.querySelector('#mt-report-display').value='table';document.querySelector('#mt-report-display').dispatchEvent(new Event('change',{bubbles:true}));")
        try await check("document.querySelectorAll('.mt-report tbody tr').length===7", "chart_table_keeps_all_seven_days")
        try await js("document.querySelector('[data-mt=chart-new]').click();")
        try await panel();try await js("document.querySelector('#mt-chart-name').value='Study comparison';document.querySelector('#mt-new-chart-type').value='custom';document.querySelector('[data-mt=chart-new-submit]').click();")
        try await wait("New chart did not close"){d.window.attachedSheet==nil}
        try await waitJS("window.HotTurkeyTracking.model.report.type==='custom'&&!window.HotTurkeyTracking.model.loading")
        try await js("document.querySelector('[data-mt=series-add]').click();")
        try await panel();try await js("document.querySelector('#mt-series-timeline').value='tags';document.querySelector('#mt-series-timeline').dispatchEvent(new Event('change',{bubbles:true}));")
        try await waitJS("document.querySelector('[data-mt-series-group][value=Study]')")
        try await js("document.querySelector('#mt-series-name').value='Study';document.querySelector('[data-mt-series-group][value=Study]').checked=true;document.querySelector('#mt-series-match').value='all';document.querySelector('[data-mt=series-save]').click();")
        try await wait("Series panel did not close"){d.window.attachedSheet==nil}
        try await waitJS("window.HotTurkeyTracking.model.report.series.length===1&&!window.HotTurkeyTracking.model.loading")
        try await check("window.HotTurkeyTracking.model.report.series[0].total===2700", "custom_tag_all_match_uses_real_tag_intervals")
        try await js("document.querySelector('[data-mt=series-add]').click();")
        try await panel();try await js("document.querySelector('#mt-series-name').value='Editor';document.querySelector('[data-mt-series-group][value=\"Fixture Editor\"]').checked=true;document.querySelector('[data-mt=series-save]').click();")
        try await wait("Second series did not close"){d.window.attachedSheet==nil}
        try await waitJS("window.HotTurkeyTracking.model.report.series.length===2&&!window.HotTurkeyTracking.model.loading")
        try await check("window.HotTurkeyTracking.model.report.series[1].total===3600", "custom_chart_compares_different_timelines")
        try await js("document.querySelector('[data-mt=chart-save]').click();await new Promise(resolve=>setTimeout(resolve,150));window.__savedChart=(await api('tracking/entities?kind=reports')).items.find(v=>v.name==='Study comparison');")
        try await check("window.__savedChart?.series.length===2&&window.__savedChart.series[0].match==='all'", "saved_chart_keeps_series_and_match_settings")
        try await js("document.querySelector('[data-mt=chart-default]').click();")
        try await waitJS("!window.HotTurkeyTracking.model.loading")
        try await js("document.querySelector('[data-mt=chart-select][data-id=\"'+window.__savedChart.id+'\"]').click();")
        try await waitJS("window.HotTurkeyTracking.model.report.series.length===2&&!window.HotTurkeyTracking.model.loading")
        try await check("window.HotTurkeyTracking.model.report.name==='Study comparison'&&window.HotTurkeyTracking.model.report.series[0].total===2700", "saved_chart_tab_restores_its_definition")
        try await check("!document.querySelector('.mt-status').textContent.includes('开始')&&document.querySelector('.mt-status').textContent.includes('2 个系列')", "report_footer_describes_report_range")
        try await check("document.querySelector('[data-mt=delete]')===null", "report_view_never_deletes_stale_day_selection")
        try await check("[...document.querySelectorAll('.mt-report-controls select')].every(el=>el.getAttribute('aria-label')!=='统计选项')", "report_controls_have_specific_accessible_names")
        try await js("const blob=await HotTurkeyChart.image(window.HotTurkeyTracking.model.report);const bytes=new Uint8Array(await blob.arrayBuffer());window.__jpegOK=blob.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&blob.size>1000;")
        try await check("window.__jpegOK", "jpeg_chart_renders_in_real_webkit")
        for format in ["csv","xlsx","jpeg"] {
            try await js("document.querySelector('[data-mt=export]').click();")
            try await panel();try await js("document.querySelector('#mt-export-format').value='\(format)';document.querySelector('[data-mt=report-export-submit]').click();")
            try await wait("Statistics save panel missing"){d.window.attachedSheet is NSSavePanel}
            guard let save=d.window.attachedSheet as? NSSavePanel else{throw fail("Save panel not on main window")}
            let ext = format == "jpeg" ? "jpg" : format
            guard save.nameFieldStringValue.hasSuffix("."+ext) else{throw fail("Wrong statistics extension")}
            checks["\(format)_export_returns_to_main_native_save_panel"]=true
            if ProcessInfo.processInfo.environment["HT_QA_CONFIRM_EXPORTS"]=="1" {
                let file=try await confirmExport(save,parent:d.window,name:"report-export."+ext),data=try Data(contentsOf:file)
                guard data.count>100 else{throw fail("Empty statistics export")}
                if format=="csv" {guard let csv=String(data:data,encoding:.utf8),csv.contains("Study"),csv.contains("Editor"),csv.contains("2700"),csv.contains("3600") else{throw fail("CSV export differs from chart")}}
                if format=="xlsx" {guard data.starts(with:[80,75,3,4]) else{throw fail("Invalid workbook export")}}
                if format=="jpeg" {guard data.starts(with:[255,216,255]),let bitmap=NSBitmapImageRep(data:data),bitmap.pixelsWide>=640 else{throw fail("Invalid JPEG chart export")}}
                checks["\(format)_native_export_writes_readable_file"]=true
            } else {save.cancel(nil);try await wait("Save panel did not cancel"){d.window.attachedSheet==nil}}
        }
        try await js("document.querySelector('#mt-report-display').value='chart';document.querySelector('#mt-report-display').dispatchEvent(new Event('change',{bubbles:true}));")
        try await capture("custom-report-light")
        for (profile,theme,scale) in [("dark","dark",100),("dark-200","dark",200)] {
            try await activateMain()
            try await js("await api('settings',{theme:'\(theme)',text_scale:\(scale)});await refresh(false);await window.HotTurkeyTracking.refresh();")
            try await check("document.documentElement.scrollWidth<=innerWidth+1", "report_\(profile)_no_page_overflow")
            try await check("[...document.querySelectorAll('.mt-report input,.mt-report select,.mt-report button')].every(el=>{const r=el.getBoundingClientRect();return r.width===0||r.left>=0&&r.right<=innerWidth+1||Boolean(el.closest('.mt-report-tabs'));})", "report_\(profile)_controls_remain_bounded")
            try await check("document.querySelector('.mt-chart-svg').innerHTML.includes('rgba(')", "report_\(profile)_uses_native_palette")
            try await capture("custom-report-"+profile)
        }
        try await js("await api('settings',{theme:'light',text_scale:100});await refresh(false);await window.HotTurkeyTracking.refresh();")
        try await js("document.querySelector('[data-mt=view][data-value=timesheet]').click();")
        try await waitJS("window.HotTurkeyTracking.model.report?.rows?.length>0&&!window.HotTurkeyTracking.model.loading")
        try await check("document.querySelector('.mt-report').textContent.includes('项目')", "timesheet_reads_saved_tags")
        try await js("document.querySelector('[data-mt=view][data-value=day]').click();")
        try await waitJS("window.HotTurkeyTracking.model.view==='day'&&!window.HotTurkeyTracking.model.loading")
        for (profile,theme,scale) in [("dark","dark",100),("dark-200","dark",200)] {
            try await activateMain()
            try await js("await api('settings',{theme:'\(theme)',text_scale:\(scale)});await refresh(false);await window.HotTurkeyTracking.refresh();")
            try await check("document.documentElement.scrollWidth<=innerWidth+1", "\(profile)_no_page_overflow")
            try await check("[...document.querySelectorAll('.tracking-mode *')].filter(el=>el.getBoundingClientRect().width&&[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).every(el=>parseFloat(getComputedStyle(el).fontSize)>=12)", "\(profile)_readable_component_text")
            try await capture("day-"+profile)
        }
    }
    func finish(_ error:Error?=nil){
        let value:[String:Any]=["passed":error==nil,"checks":checks,"error":error?.localizedDescription ?? "","formal_data_changed":false,"enforcement":false,"physical_device_actions":false,"synthetic_screenshots_only":true]
        if let data=try? JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys]){try? data.write(to:root.appendingPathComponent("build/native-tracking-proof.json"))}
        d.appearance.cancelEditor();NSApp.terminate(nil)
    }
}
@main @MainActor enum TrackingFixture {
 static func main(){alarm(ProcessInfo.processInfo.environment["HT_QA_MANUAL_ACTIVATION"]=="1" ? 180 : 90);let app=NSApplication.shared,d=Delegate();app.setActivationPolicy(.regular);app.delegate=d;DesktopMenu.install(delegate:d);let qa=TrackingQA(d,root:CommandLine.arguments[1]);Task{@MainActor in do{try await qa.run();qa.finish()}catch{qa.finish(error)}};withExtendedLifetime((d,qa)){app.run()}}
}
