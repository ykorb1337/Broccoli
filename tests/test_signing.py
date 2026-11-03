import unittest
from unittest.mock import patch
from scripts.signing import command,sign,developer_id_signed

class SigningTests(unittest.TestCase):
 def test_local_default_remains_adhoc(self):
  with patch.dict('os.environ',{},clear=True):
   self.assertEqual(command('App.app',deep=True),['/usr/bin/codesign','--force','--deep','--sign','-','App.app'])
 def test_configured_identity_applies_consistently_and_fails_closed(self):
  with patch.dict('os.environ',{'BROCCOLI_SIGNING_IDENTITY':'Developer ID Application: Fixture (TEAM)'}):
   for target in ['App.app','Tracker','Installer.app','Uninstaller.app','extension.so']:
    args=command(target);self.assertIn('--timestamp',args);self.assertEqual(args[args.index('--sign')+1],'Developer ID Application: Fixture (TEAM)');self.assertIn('runtime',args)
   with patch('scripts.signing.subprocess.run',side_effect=RuntimeError('Certificate unavailable')) as run:
    with self.assertRaises(RuntimeError):sign('App.app')
    self.assertEqual(run.call_count,1,'never fall back to another signing identity')
 def test_empty_identity_is_rejected(self):
  with patch.dict('os.environ',{'BROCCOLI_SIGNING_IDENTITY':' '}):
   with self.assertRaises(ValueError):command('App.app')
 def test_proof_requires_actual_developer_id(self):
  with patch('scripts.signing.subprocess.run') as run:
   run.return_value.stderr='Signature=adhoc';self.assertFalse(developer_id_signed('App.app'))
   run.return_value.stderr='Authority=Developer ID Application: Fixture (TEAM)';self.assertTrue(developer_id_signed('App.app'))
