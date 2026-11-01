import Foundation
import CoreGraphics
@main struct Check {
 static func main() {
  let large=DesktopWindowLayout.frame(in:CGRect(x:0,y:0,width:2000,height:1400))
  precondition(large.size==CGSize(width:1590,height:1152))
  let screen=CGRect(x:-1440,y:25,width:1440,height:875)
  let small=DesktopWindowLayout.frame(in:screen)
  precondition(screen.contains(small));precondition(small.midX==screen.midX && small.midY==screen.midY)
  precondition(small.width==1408 && small.height==843)
  print("3 default window size, small display and negative-origin layout checks passed")
 }
}
