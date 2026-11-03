import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from broccoli.paths import user_data_directory
from broccoli.server import default_data

class DataPathTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.home=Path(self.tmp.name);self.base=self.home/'Library/Application Support';self.base.mkdir(parents=True)
  self.old=self.base/'HotTurkey';self.new=self.base/'Broccoli'
 def tearDown(self):self.tmp.cleanup()
 def database(self,path):path.mkdir();(path/'broccoli.sqlite3').touch()
 def test_existing_legacy_is_unchanged(self):
  self.database(self.old);self.new.mkdir();(self.new/'desktop.log').touch()
  self.assertEqual(user_data_directory(self.home),self.old)
 def test_renamed_data_wins_over_empty_recreated_directory(self):
  self.database(self.new);self.old.mkdir();(self.old/'desktop.log').touch()
  self.assertEqual(user_data_directory(self.home),self.new)
 def test_compatibility_link_selects_real_protected_directory(self):
  self.database(self.new);self.old.symlink_to(self.new,target_is_directory=True)
  self.assertEqual(user_data_directory(self.home),self.new)
 def test_distinct_databases_are_not_silently_selected(self):
  self.database(self.old);self.database(self.new)
  with self.assertRaises(ValueError):user_data_directory(self.home)
 def test_explicit_test_directory_is_respected(self):
  with patch.dict('os.environ',{'HOTTURKEY_DATA':'/isolated/fixture'}):self.assertEqual(default_data(),Path('/isolated/fixture'))

class DatabaseNameMigrationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def legacy(self):
  import sqlite3
  old=self.root/'hotturkey.sqlite3';db=sqlite3.connect(str(old));db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE fixture(value TEXT)');db.execute('INSERT INTO fixture VALUES(?)',('preserved',));db.commit();db.close();return old
 def test_existing_legacy_file_is_read_without_creating_a_new_database(self):
  from broccoli.paths import policy_database
  old=self.legacy();self.assertEqual(policy_database(self.root),old);self.assertFalse((self.root/'broccoli.sqlite3').exists())
 def test_checkpointed_rename_preserves_database_and_reopens(self):
  import sqlite3
  from broccoli.paths import migrate_policy_database,policy_database
  old=self.legacy();self.assertTrue(migrate_policy_database(self.root));self.assertFalse(old.exists())
  with sqlite3.connect(str(policy_database(self.root))) as db:self.assertEqual(db.execute('SELECT value FROM fixture').fetchone()[0],'preserved')
  self.assertFalse(migrate_policy_database(self.root))
 def test_running_service_lease_blocks_rename(self):
  from broccoli.paths import migrate_policy_database
  from broccoli.service_lease import ServiceLease
  old=self.legacy()
  with ServiceLease(self.root/'service.lock'):
   with self.assertRaises((BlockingIOError,PermissionError)):migrate_policy_database(self.root)
  self.assertTrue(old.exists());self.assertFalse((self.root/'broccoli.sqlite3').exists())
 def test_two_databases_stop_migration(self):
  from broccoli.paths import migrate_policy_database
  self.legacy();(self.root/'broccoli.sqlite3').touch()
  with self.assertRaises(ValueError):migrate_policy_database(self.root)
 def test_fresh_install_uses_broccoli_directory(self):
  from broccoli.paths import user_data_directory
  self.assertEqual(user_data_directory(self.root),self.root/'Library/Application Support/Broccoli')
