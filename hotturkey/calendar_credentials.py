"""Calendar credentials in the current user's macOS Keychain, never policy storage."""
import ctypes as C
import hashlib
import json
import sys
from .model import PolicyError

class CalendarCredentials:
    def __init__(self,directory):
        self.account=hashlib.sha256(str(directory.resolve()).encode()).hexdigest()
        self.service='local.hotturkey.google-calendar'
    def _libraries(self):
        if sys.platform!='darwin':raise PolicyError('Google 日历凭据需要 macOS 钥匙串')
        cf=C.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');sec=C.CDLL('/System/Library/Frameworks/Security.framework/Security')
        for name,args,result in [('CFStringCreateWithCString',[C.c_void_p,C.c_char_p,C.c_uint32],C.c_void_p),('CFDictionaryCreateMutable',[C.c_void_p,C.c_long,C.c_void_p,C.c_void_p],C.c_void_p),('CFDictionarySetValue',[C.c_void_p,C.c_void_p,C.c_void_p],None),('CFDataCreate',[C.c_void_p,C.c_void_p,C.c_long],C.c_void_p),('CFDataGetLength',[C.c_void_p],C.c_long),('CFDataGetBytePtr',[C.c_void_p],C.c_void_p),('CFRelease',[C.c_void_p],None)]:
            fn=getattr(cf,name);fn.argtypes=args;fn.restype=result
        for name,args in [('SecItemCopyMatching',[C.c_void_p,C.POINTER(C.c_void_p)]),('SecItemAdd',[C.c_void_p,C.POINTER(C.c_void_p)]),('SecItemUpdate',[C.c_void_p,C.c_void_p]),('SecItemDelete',[C.c_void_p])]:
            fn=getattr(sec,name);fn.argtypes=args;fn.restype=C.c_int32
        return cf,sec
    def _query(self,cf,sec):
        value=cf.CFDictionaryCreateMutable(None,0,C.addressof((C.c_byte*1).in_dll(cf,'kCFTypeDictionaryKeyCallBacks')),C.addressof((C.c_byte*1).in_dll(cf,'kCFTypeDictionaryValueCallBacks')))
        def key(name):return C.c_void_p.in_dll(sec,name).value
        cf.CFDictionarySetValue(value,key('kSecClass'),key('kSecClassGenericPassword'))
        for name,text in [('kSecAttrService',self.service),('kSecAttrAccount',self.account)]:
            string=cf.CFStringCreateWithCString(None,text.encode(),0x08000100)
            cf.CFDictionarySetValue(value,key(name),string);cf.CFRelease(string)
        return value,key
    def load(self):
        cf,sec=self._libraries();query,key=self._query(cf,sec);result=C.c_void_p()
        try:
            cf.CFDictionarySetValue(query,key('kSecReturnData'),C.c_void_p.in_dll(cf,'kCFBooleanTrue').value)
            cf.CFDictionarySetValue(query,key('kSecMatchLimit'),key('kSecMatchLimitOne'))
            status=sec.SecItemCopyMatching(query,C.byref(result))
            if status==-25300:return {}
            if status!=0:raise PolicyError('无法读取 Google 日历钥匙串，请解锁 macOS 后重试')
            raw=C.string_at(cf.CFDataGetBytePtr(result),cf.CFDataGetLength(result))
            return json.loads(raw)
        finally:
            if result.value:cf.CFRelease(result)
            cf.CFRelease(query)
    def save(self,value):
        cf,sec=self._libraries();query,key=self._query(cf,sec)
        raw=json.dumps(value).encode();buffer=C.create_string_buffer(raw);data=cf.CFDataCreate(None,C.cast(buffer,C.c_void_p),len(raw));attributes=cf.CFDictionaryCreateMutable(None,0,None,None)
        try:
            cf.CFDictionarySetValue(attributes,key('kSecValueData'),data)
            status=sec.SecItemUpdate(query,attributes)
            if status==-25300:
                cf.CFDictionarySetValue(query,key('kSecValueData'),data)
                cf.CFDictionarySetValue(query,key('kSecAttrAccessible'),key('kSecAttrAccessibleWhenUnlockedThisDeviceOnly'))
                status=sec.SecItemAdd(query,None)
            if status!=0:raise PolicyError('无法保存 Google 日历凭据到钥匙串')
        finally:cf.CFRelease(attributes);cf.CFRelease(data);cf.CFRelease(query)
    def delete(self):
        cf,sec=self._libraries();query,_=self._query(cf,sec)
        try:
            if sec.SecItemDelete(query) not in (0,-25300):raise PolicyError('无法移除 Google 日历凭据')
        finally:cf.CFRelease(query)
