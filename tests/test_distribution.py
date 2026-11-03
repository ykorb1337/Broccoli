import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('distribution_builder',ROOT/'scripts/build_distribution.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.app=Path(self.temp.name)/'Broccoli.app';self.project=self.app/'Contents/Resources/project';self.project.mkdir(parents=True)
    def tearDown(self):self.temp.cleanup()
    def test_main_without_uninstaller_or_private_data_is_allowed(self):builder.validate_main(self.app)
    def test_uninstall_backend_cannot_ship_with_the_main_app(self):
        path=self.project/'broccoli/uninstall.py';path.parent.mkdir();path.write_text('fixture')
        with self.assertRaises(ValueError):builder.validate_main(self.app)
    def test_nested_uninstaller_app_cannot_ship(self):
        (self.app/'Contents/Resources/Broccoli Uninstaller.app').mkdir()
        with self.assertRaises(ValueError):builder.validate_main(self.app)
    def test_local_data_and_client_configuration_are_rejected(self):
        for name in ['broccoli.sqlite3','tracking.sqlite3-wal','connection.json','client_secret_fixture.json']:
            path=self.project/name;path.write_text('private fixture')
            with self.assertRaises(ValueError):builder.validate_main(self.app)
            path.unlink()
    def test_installer_and_uninstaller_use_separate_native_modes(self):
        with patch.object(builder.subprocess,'run') as run:
            builder.compile_setup('uninstall');self.assertIn('BROCCOLI_UNINSTALLER',run.call_args.args[0])
            builder.compile_setup('install');self.assertNotIn('BROCCOLI_UNINSTALLER',run.call_args.args[0])

if __name__=='__main__':unittest.main()
