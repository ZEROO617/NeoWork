import concurrent.futures, importlib.util, json, os, tempfile, threading, unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from pathlib import Path

class SharedServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();os.environ['NEOWORK_DB']=cls.temp.name+'/test.sqlite3'
        spec=importlib.util.spec_from_file_location('neowork_server',Path(__file__).resolve().parents[1]/'server/app.py');cls.app=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.app);cls.app.initialize()
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),cls.app.Handler);cls.url='http://127.0.0.1:'+str(cls.http.server_port)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls): cls.http.shutdown();cls.http.server_close();cls.temp.cleanup()
    def state(self):
        with urlopen(self.url+'/api/state') as r:return json.load(r)
    def post(self,path,data,headers=None):
        request=Request(self.url+path,data=json.dumps(data).encode(),headers={'Content-Type':'application/json',**(headers or {})})
        with urlopen(request) as r:return r.status,json.load(r)
    def test_shared_concurrent_writers_and_persistence(self):
        def send(i): return self.post('/api/messages',{'id':'parallel-'+str(i),'room':'project','name':'사용자'+str(i),'text':'동시 전송 '+str(i),'time':'2026-11-12T03:00:00.000Z'})
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool: results=list(pool.map(send,range(10)))
        self.assertTrue(all(r[0]==201 for r in results))
        state=self.state();self.assertEqual(len([m for m in state['messages'] if m['id'].startswith('parallel-')]),10)
        self.app.initialize();self.assertEqual(len(self.state()['messages']),len(state['messages']))
    def test_invalid_message_and_unknown_room_rejected(self):
        for data,code in [({'text':''},400),({'id':'badroom','room':'missing','name':'테스터','text':'안녕','time':'2026-11-12T03:00:00Z'},404)]:
            with self.assertRaises(HTTPError) as cm:self.post('/api/messages',data)
            self.assertEqual(cm.exception.code,code)
    def test_cross_origin_write_rejected(self):
        with self.assertRaises(HTTPError) as cm:self.post('/api/rooms',{'id':'evil','name':'x','description':'x'},{'Origin':'https://unrelated.example'})
        self.assertEqual(cm.exception.code,403)
    def test_room_visible_to_other_client(self):
        self.post('/api/rooms',{'id':'testroom','name':'새 채팅방','description':'테스트'})
        self.assertTrue(any(r['id']=='testroom' for r in self.state()['rooms']))
    def test_no_gemini_key_returns_explicit_fallback(self):
        old=os.environ.pop('GEMINI_API_KEY',None)
        try:self.assertEqual(self.post('/api/ai',{'question':'내 업무','room':'project','user':'김민지'})[1]['mode'],'rules')
        finally:
            if old:os.environ['GEMINI_API_KEY']=old

if __name__=='__main__':unittest.main()
