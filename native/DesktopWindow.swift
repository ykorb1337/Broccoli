import Foundation
import CoreGraphics

/// Default outer frame, bounded to the display and centred on that display.
enum DesktopWindowLayout {
    static let preferredSize = CGSize(width:1590,height:1152)
    static func frame(in visible:CGRect) -> CGRect {
        let width=min(preferredSize.width,max(1,visible.width-32))
        let height=min(preferredSize.height,max(1,visible.height-32))
        return CGRect(x:visible.midX-width/2,y:visible.midY-height/2,width:width,height:height)
    }
}
