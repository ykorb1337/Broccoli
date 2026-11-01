import base64
import sqlite3
import tempfile
import unittest
from pathlib import Path
from hotturkey.website_icons import WebsiteIcons,hostname
from hotturkey.model import PolicyError

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')

class WebsiteIconTests(unittest.TestCase):
    def test_only_web_hosts(self):
        self.assertEqual(hostname('https://CHATGPT.com/c/one'),'chatgpt.com')
        self.assertEqual(hostname('www.bilibili.com'),'www.bilibili.com')
        for value in ['file:///etc/passwd','edge://newtab','https://u:p@example.org','https://bad%00.org',None]:self.assertEqual(hostname(value),'')

    def test_local_cache_scoped_prefix_and_no_source_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'Favicons'
            with sqlite3.connect(path) as db:
                db.executescript('CREATE TABLE icon_mapping(page_url TEXT,icon_id INTEGER);CREATE INDEX pages ON icon_mapping(page_url);CREATE TABLE favicon_bitmaps(icon_id INTEGER,width INTEGER,image_data BLOB);')
                db.executemany('INSERT INTO icon_mapping VALUES(?,?)',[('https://example.org/path',1),('https://evil-example.org/path',2),('https://example.org.evil/path',2)])
                db.executemany('INSERT INTO favicon_bitmaps VALUES(?,?,?)',[(1,32,PNG),(2,32,b'bad')])
            before=path.read_bytes();now=[0];cache=WebsiteIcons([path],clock=lambda:now[0])
            value=cache.resolve(['example.org','https://example.org/another','missing.org'])['items']
            self.assertEqual(len(value),2);self.assertEqual(value[0]['image'],'data:image/png;base64,'+base64.b64encode(PNG).decode());self.assertIsNone(value[1]['image']);self.assertEqual(path.read_bytes(),before)
            path.unlink();self.assertTrue(cache.resolve(['example.org'])['items'][0]['image'])
            now[0]=601;self.assertIsNone(cache.resolve(['example.org'])['items'][0]['image'])

    def test_corrupt_missing_or_oversized_images_fall_back(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'broken';path.write_bytes(b'not sqlite')
            self.assertIsNone(WebsiteIcons([path,Path(directory)/'missing']).resolve(['example.org'])['items'][0]['image'])
        for targets in [None,'example.org',['example.org']*101]:
            with self.assertRaises(PolicyError):WebsiteIcons([]).resolve(targets)

if __name__=='__main__':unittest.main()
