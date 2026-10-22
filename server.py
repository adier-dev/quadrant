"""象限：仅使用 Python 标准库的个人多端任务服务器。Python 3.10+。"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import io
import json
import mimetypes
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import sys
import threading
import time
import traceback
from contextlib import contextmanager
from datetime import date
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlsplit
import uuid
import webbrowser
import zipfile
from lan_sync import LanSync

ROOT = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
WEB = ROOT / 'web'
DEFAULT_SETTINGS = {'name': '象限', 'subtitle': '把时间留给重要的事', 'accent': 'green', 'focus_minutes': 25, 'break_minutes': 5}
MAX_BODY = 64 * 1024 * 1024
MAX_TIMER_SECONDS = 24 * 3600
ALARM_ID = '0' * 32
TASK_FIELDS = ('title', 'notes', 'important', 'urgent', 'done', 'pinned', 'due',
               'id', 'revision', 'created_at', 'updated_at', 'completed_at', 'deleted_at')


def task_record(value):
    return {key: value[key] for key in TASK_FIELDS if key in value}


class Problem(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def now():
    return int(time.time() * 1000)


def ident():
    return uuid.uuid4().hex


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 240000).hex()


def text_value(value, name, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise Problem(f'{name}不能为空或超过 {limit} 字')
    return value.strip()


def task_values(body):
    if not isinstance(body, dict):
        raise Problem('任务格式错误')
    result = {'title': text_value(body.get('title', ''), '任务标题', 500, True),
              'notes': text_value(body.get('notes', ''), '备注', 20000)}
    for key in ('important', 'urgent', 'done', 'pinned'):
        if not isinstance(body.get(key, False), bool):
            raise Problem('任务标记必须是布尔值')
        result[key] = body.get(key, False)
    due = body.get('due', '')
    if due:
        try:
            if date.fromisoformat(due).isoformat() != due:
                raise ValueError()
        except (ValueError, TypeError):
            raise Problem('日期格式应为 YYYY-MM-DD')
    result['due'] = due or ''
    return result


class Store:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.path.mkdir(parents=True, exist_ok=True)
        (self.path / 'attachments').mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.attempts = {}
        with self.db() as db:
            db.executescript('''PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS focus_logs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS purged (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS alarm (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS lan_peers (id TEXT PRIMARY KEY, body TEXT NOT NULL);
            ''')
            db.execute("INSERT OR IGNORE INTO meta VALUES ('revision','0')")
            db.execute("INSERT OR IGNORE INTO meta VALUES ('settings',?)", (encode(DEFAULT_SETTINGS),))
            db.execute("INSERT OR IGNORE INTO meta VALUES ('timer',?)", (encode(self.blank_timer()),))
            db.execute('INSERT OR IGNORE INTO alarm VALUES (?,?)', (ALARM_ID, encode({'id': ALARM_ID, 'file_id': '', 'revision': 1, 'updated_at': 0})))
            # Upgrade stored records and peer snapshots to the current task shape.
            for task in self.rows(db, 'tasks'):
                self.put(db, 'tasks', task)
            for peer in self.rows(db, 'lan_peers'):
                for snapshot in [peer.get('baseline'), (peer.get('pending') or {}).get('snapshot')]:
                    if snapshot:
                        snapshot['tasks'] = [task_record(t) for t in snapshot.get('tasks', [])]
                self.put(db, 'lan_peers', peer)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path / 'quadrant.sqlite3', timeout=20)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def write(self):
        with self.lock, self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")

    @staticmethod
    def blank_timer(revision=0):
        return {'status': 'idle', 'mode': 'focus', 'task_id': '', 'duration': 0, 'remaining': 0, 'ends_at': 0, 'revision': revision}

    @staticmethod
    def meta(db, key):
        row = db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return json.loads(row['value']) if row else None

    @staticmethod
    def setmeta(db, key, value):
        db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)', (key, encode(value)))

    @staticmethod
    def row(db, table, id_):
        row = db.execute(f'SELECT body FROM {table} WHERE id=?', (id_,)).fetchone()
        if not row:
            raise Problem('记录不存在', 404)
        return json.loads(row['body'])

    @staticmethod
    def put(db, table, value):
        if table == 'tasks':
            value = task_record(value)
        db.execute(f'INSERT OR REPLACE INTO {table} VALUES (?,?)', (value['id'], encode(value)))

    @staticmethod
    def rows(db, table):
        return [json.loads(r['body']) for r in db.execute(f'SELECT body FROM {table}')]

    def authenticated(self, token):
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.db() as db:
            return bool(db.execute('SELECT 1 FROM sessions WHERE token=? AND expires>?', (digest, now())).fetchone())

    def login(self, body, ip, setup=False):
        password = text_value(body.get('password', ''), '访问密码', 128, True)
        with self.lock:
            tries = [t for t in self.attempts.get(ip, []) if time.time() - t < 300]
            if len(tries) >= 10:
                raise Problem('尝试次数过多，请 5 分钟后再试', 429)
            with self.db() as db:
                auth = self.meta(db, 'auth')
                if setup:
                    if auth:
                        raise Problem('已经完成初始化', 409)
                    if len(password) < 8:
                        raise Problem('访问密码至少 8 位')
                    salt = secrets.token_hex(16)
                    self.setmeta(db, 'auth', {'salt': salt, 'hash': password_hash(password, salt)})
                    settings = dict(DEFAULT_SETTINGS)
                    settings['name'] = text_value(body.get('name', '象限'), '应用名称', 30, True)
                    self.setmeta(db, 'settings', settings)
                elif not auth or not hmac.compare_digest(auth['hash'], password_hash(password, auth['salt'])):
                    self.attempts[ip] = tries + [time.time()]
                    raise Problem('访问密码不正确', 401)
                self.attempts.pop(ip, None)
                token = secrets.token_urlsafe(32)
                db.execute('DELETE FROM sessions WHERE expires<?', (now(),))
                db.execute('INSERT INTO sessions VALUES (?,?)', (hashlib.sha256(token.encode()).hexdigest(), now() + 7 * 86400000))
                return token

    def advance_timer(self):
        with self.lock, self.db() as db:
            timer = self.meta(db, 'timer')
            if timer['status'] == 'running' and now() >= timer['ends_at']:
                if timer['mode'] in ('focus', 'custom'):
                    self.put(db, 'focus_logs', {'id': ident(), 'task_id': timer['task_id'], 'duration': timer['duration'], 'finished_at': timer['ends_at']})
                self.setmeta(db, 'timer', self.blank_timer(timer['revision'] + 1))
                db.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")

    def state(self):
        self.advance_timer()
        with self.lock, self.db() as db:
            return {'revision': self.meta(db, 'revision'), 'settings': self.meta(db, 'settings'),
                    'tasks': self.rows(db, 'tasks'), 'files': self.rows(db, 'files'),
                    'timer': self.meta(db, 'timer'), 'focus_logs': self.rows(db, 'focus_logs'),
                    'purged': self.rows(db, 'purged'), 'alarm': self.rows(db, 'alarm'), 'server_time': now()}

    def create_task(self, body):
        values = task_values(body)
        stamp = now()
        task = dict(values, id=ident(), revision=1, created_at=stamp, updated_at=stamp,
                    completed_at=stamp if values['done'] else None, deleted_at=None)
        with self.write() as db:
            self.put(db, 'tasks', task)
        return task

    def update_task(self, id_, body, delete=False):
        with self.write() as db:
            task = self.row(db, 'tasks', id_)
            if body.get('revision') != task['revision']:
                raise Problem('这条任务已被其他设备修改。已同步最新内容，请重新打开后编辑。', 409)
            if delete:
                task['deleted_at'] = now()
            else:
                task.update(task_values(dict(task, **body)))
                if 'deleted_at' in body:
                    if body['deleted_at'] is not None:
                        raise Problem('请使用删除操作')
                    task['deleted_at'] = None
            task['completed_at'] = (task.get('completed_at') or now()) if task['done'] else None
            task.update(revision=task['revision'] + 1, updated_at=now())
            self.put(db, 'tasks', task)
        return task

    def timer_action(self, body):
        self.advance_timer()
        with self.write() as db:
            timer = self.meta(db, 'timer')
            if body.get('revision') != timer['revision']:
                raise Problem('计时状态已在另一台设备上改变，请重试', 409)
            action = body.get('action')
            if action == 'start' and timer['status'] == 'idle':
                mode = body.get('mode', 'focus')
                if mode not in ('focus', 'break', 'custom'):
                    raise Problem('计时类型无效')
                settings = self.meta(db, 'settings')
                duration = settings['focus_minutes' if mode == 'focus' else 'break_minutes'] * 60
                if mode == 'custom':
                    duration = body.get('duration')
                    if type(duration) is not int or not 60 <= duration <= MAX_TIMER_SECONDS or duration % 60:
                        raise Problem('自定义时间应为 1 分钟至 24 小时，按整分钟设置')
                task_id = body.get('task_id', '')
                if task_id:
                    task = self.row(db, 'tasks', task_id)
                    if task.get('deleted_at'):
                        raise Problem('任务已删除')
                timer.update(status='running', mode=mode, task_id=task_id, duration=duration, remaining=duration, ends_at=now() + duration * 1000)
            elif action == 'pause' and timer['status'] == 'running':
                timer.update(status='paused', remaining=max(0, (timer['ends_at'] - now()) / 1000), ends_at=0)
            elif action == 'resume' and timer['status'] == 'paused':
                timer.update(status='running', ends_at=now() + int(timer['remaining'] * 1000))
            elif action == 'cancel' and timer['status'] != 'idle':
                timer = self.blank_timer(timer['revision'])
            else:
                raise Problem('当前状态无法执行此操作', 409)
            timer['revision'] += 1
            self.setmeta(db, 'timer', timer)
        return timer

    def purge_task(self, id_, body):
        with self.write() as db:
            task = self.row(db, 'tasks', id_)
            if body.get('revision') != task['revision']:
                raise Problem('任务已被修改，请刷新后再永久删除', 409)
            if not task.get('deleted_at'):
                raise Problem('只能永久删除回收站中的任务', 409)
            files = [f for f in self.rows(db, 'files') if f.get('task_id') == id_]
            self.put(db, 'purged', {'id': id_, 'deleted_at': now()})
            db.execute('DELETE FROM tasks WHERE id=?', (id_,))
            for file in files:
                db.execute('DELETE FROM files WHERE id=?', (file['id'],))
            # Remove task content retained in previous peer baselines too.
            for peer in self.rows(db, 'lan_peers'):
                for snapshot in [peer.get('baseline'), (peer.get('pending') or {}).get('snapshot')]:
                    if snapshot:
                        snapshot['tasks'] = [t for t in snapshot.get('tasks', []) if t['id'] != id_]
                        snapshot['files'] = [f for f in snapshot.get('files', []) if f.get('task_id') != id_]
                self.put(db, 'lan_peers', peer)
        for file in files:
            (self.path / 'attachments' / file['id']).unlink(missing_ok=True)
        return {'ok': True}

    def upload_alarm(self, name, data, mime, revision):
        name = text_value(name.replace('\\', '/').split('/')[-1], '音频名称', 200, True)
        if Path(name).suffix.lower() not in ('.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.webm'):
            raise Problem('请选择 MP3、WAV、M4A、OGG 等音频文件')
        if not data or len(data) > 20 * 1024 * 1024:
            raise Problem('提示音应为 1 字节至 20 MB')
        with self.write() as db:
            config = self.row(db, 'alarm', ALARM_ID)
            if revision != config['revision']:
                raise Problem('提示音已被修改，请刷新后重试', 409)
            old = [f for f in self.rows(db, 'files') if f.get('kind') == 'alarm']
            file = {'id': ident(), 'task_id': '', 'kind': 'alarm', 'name': name, 'size': len(data),
                    'mime': mimetypes.guess_type(name)[0] or 'audio/mpeg', 'created_at': now()}
            (self.path / 'attachments' / file['id']).write_bytes(data)
            for previous in old:
                db.execute('DELETE FROM files WHERE id=?', (previous['id'],))
            self.put(db, 'files', file)
            config.update(file_id=file['id'], updated_at=now(), revision=config['revision'] + 1)
            self.put(db, 'alarm', config)
        for previous in old:
            (self.path / 'attachments' / previous['id']).unlink(missing_ok=True)
        return config

    def clear_alarm(self, revision):
        with self.write() as db:
            config = self.row(db, 'alarm', ALARM_ID)
            if revision != config['revision']:
                raise Problem('提示音已被修改，请刷新后重试', 409)
            files = [f for f in self.rows(db, 'files') if f.get('kind') == 'alarm']
            for file in files:
                db.execute('DELETE FROM files WHERE id=?', (file['id'],))
            config.update(file_id='', updated_at=now(), revision=config['revision'] + 1)
            self.put(db, 'alarm', config)
        for file in files:
            (self.path / 'attachments' / file['id']).unlink(missing_ok=True)
        return {'ok': True}

    def update_settings(self, body):
        with self.write() as db:
            settings = self.meta(db, 'settings')
            settings['name'] = text_value(body.get('name', settings['name']), '应用名称', 30, True)
            settings['subtitle'] = text_value(body.get('subtitle', settings['subtitle']), '副标题', 100)
            accent = body.get('accent', settings['accent'])
            if accent not in ('green', 'blue', 'purple', 'orange'):
                raise Problem('主题无效')
            settings['accent'] = accent
            for key in ('focus_minutes', 'break_minutes'):
                v = body.get(key, settings[key])
                if type(v) is not int or not 1 <= v <= 180:
                    raise Problem('计时长度应为 1—180 分钟')
                settings[key] = v
            self.setmeta(db, 'settings', settings)
        return settings

    def upload(self, task_id, name, data):
        if not data or len(data) > 20 * 1024 * 1024:
            raise Problem('附件应为 1 字节至 20 MB')
        name = text_value(name.replace('\\', '/').split('/')[-1], '文件名', 200, True)
        file = {'id': ident(), 'task_id': task_id, 'name': name, 'size': len(data), 'created_at': now()}
        with self.write() as db:
            task = self.row(db, 'tasks', task_id)
            if task.get('deleted_at'):
                raise Problem('任务已删除')
            if db.execute('SELECT COUNT(*) FROM files WHERE json_extract(body,\'$.task_id\')=?', (task_id,)).fetchone()[0] >= 12:
                raise Problem('每个任务最多 12 个附件')
            (self.path / 'attachments' / file['id']).write_bytes(data)
            self.put(db, 'files', file)
        return file

    def backup(self):
        with self.lock:
            state = self.state()
            state['format'] = 'quadrant-backup-v1'
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
                z.writestr('snapshot.json', encode(state))
                for file in state['files']:
                    path = self.path / 'attachments' / file['id']
                    if path.is_file():
                        z.write(path, 'attachments/' + file['id'])
                    else:
                        raise Problem('附件文件缺失，备份未生成，请检查数据目录', 500)
            return buf.getvalue()

    def import_data(self, data):
        files_data = {}
        try:
            if data.startswith(b'PK'):
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    if len(z.infolist()) > 20000 or sum(f.file_size for f in z.infolist()) > 256 * 1024 * 1024:
                        raise Problem('备份解压后不能超过 256 MB / 20000 个文件')
                    snapshot = json.loads(z.read('snapshot.json'))
                    for f in snapshot.get('files', []):
                        fid = f['id']
                        if not isinstance(fid, str) or not (len(fid) == 32 and all(c in '0123456789abcdef' for c in fid)):
                            raise Problem('备份附件编号无效')
                        files_data[fid] = z.read('attachments/' + fid)
            else:
                snapshot = json.loads(data)
            if not isinstance(snapshot, dict) or snapshot.get('format') != 'quadrant-backup-v1':
                raise Problem('请选择由本应用导出的 ZIP 或 JSON')
        except (ValueError, KeyError, TypeError, AttributeError, zipfile.BadZipFile):
            raise Problem('备份文件损坏或格式不正确')
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get('tasks'), list) or len(snapshot['tasks']) > 10000:
            raise Problem('备份任务格式无效，单次最多 10000 条')
        prepared = []
        ids = set()
        for raw in snapshot['tasks']:
            v = task_values(raw)
            id_ = raw.get('id')
            if not isinstance(id_, str) or len(id_) > 100 or not id_ or id_ in ids:
                raise Problem('任务编号无效或重复')
            ids.add(id_)
            stamp = now()
            timestamps = {}
            for key in ('created_at', 'updated_at', 'completed_at', 'deleted_at'):
                val = raw.get(key)
                if val is not None and (type(val) is not int or not 0 <= val <= 32503680000000):
                    raise Problem('备份时间戳无效')
                timestamps[key] = val
            prepared.append(dict(v, id=id_, revision=1, created_at=timestamps['created_at'] or stamp,
                                 updated_at=timestamps['updated_at'] or stamp,
                                 completed_at=(timestamps['completed_at'] or stamp) if v['done'] else None,
                                 deleted_at=timestamps['deleted_at']))
        imported = set()
        markers = snapshot.get('purged', [])
        if not isinstance(markers, list) or len(markers) > 10000:
            raise Problem('永久删除记录格式无效')
        for marker in markers:
            if not isinstance(marker, dict) or not isinstance(marker.get('id'), str) or len(marker['id']) > 100 or type(marker.get('deleted_at')) is not int:
                raise Problem('永久删除记录格式无效')
        with self.write() as db:
            purged = {m['id'] for m in self.rows(db, 'purged')} | {m['id'] for m in markers}
            for t in prepared:
                if t['id'] not in purged and not db.execute('SELECT 1 FROM tasks WHERE id=?', (t['id'],)).fetchone():
                    self.put(db, 'tasks', t)
                    imported.add(t['id'])
            for marker in markers:
                if not db.execute('SELECT 1 FROM tasks WHERE id=?', (marker['id'],)).fetchone():
                    self.put(db, 'purged', marker)
            config = self.row(db, 'alarm', ALARM_ID)
            incoming_alarm = snapshot.get('alarm', [])
            sound_id = incoming_alarm[0].get('file_id', '') if isinstance(incoming_alarm, list) and incoming_alarm else ''
            for f in snapshot.get('files', []):
                is_sound = f.get('kind') == 'alarm' and f.get('id') == sound_id and not config['file_id']
                if (f.get('task_id') not in imported and not is_sound) or f.get('id') not in files_data:
                    continue
                if not 0 < len(files_data[f['id']]) <= 20 * 1024 * 1024:
                    raise Problem('备份附件超出 20 MB 或为空')
                file = {'id': ident(), 'task_id': f['task_id'], 'name': text_value(f['name'], '文件名', 200, True),
                        'size': len(files_data[f['id']]), 'created_at': now()}
                if is_sound:
                    file.update(kind='alarm', task_id='', mime=mimetypes.guess_type(file['name'])[0] or 'audio/mpeg')
                    config.update(file_id=file['id'], revision=config['revision'] + 1, updated_at=now())
                    self.put(db, 'alarm', config)
                (self.path / 'attachments' / file['id']).write_bytes(files_data[f['id']])
                self.put(db, 'files', file)
            logs = snapshot.get('focus_logs', [])
            if not isinstance(logs, list) or len(logs) > 20000:
                raise Problem('专注记录格式无效')
            for log in logs:
                if not isinstance(log, dict) or not isinstance(log.get('id'), str) or len(log['id']) > 100:
                    raise Problem('专注记录编号无效')
                if type(log.get('duration')) is not int or not 1 <= log['duration'] <= MAX_TIMER_SECONDS or type(log.get('finished_at')) is not int:
                    raise Problem('专注记录格式无效')
                if not db.execute('SELECT 1 FROM focus_logs WHERE id=?', (log['id'],)).fetchone():
                    self.put(db, 'focus_logs', {'id': log['id'], 'task_id': str(log.get('task_id', ''))[:100], 'duration': log['duration'], 'finished_at': log['finished_at']})
        return {'imported': len(imported), 'skipped': len(prepared) - len(imported), 'settings_imported': False}


class Handler(BaseHTTPRequestHandler):
    server_version = 'Quadrant/1.0'

    @property
    def store(self):
        return self.server.store

    def log_message(self, format_, *args):
        if args and '/api/state' in str(args[0]):
            return
        super().log_message(format_, *args)

    def send_bytes(self, data, content_type='application/json; charset=utf-8', status=200, headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def reply(self, value, status=200, headers=None):
        self.send_bytes(encode(value).encode('utf-8'), status=status, headers=headers)

    def read_body(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise Problem('请求长度无效')
        if not 0 <= length <= MAX_BODY:
            raise Problem('单次上传不能超过 64 MB', 413)
        data = self.rfile.read(length)
        if len(data) != length:
            raise Problem('上传中断')
        return data

    def json_body(self):
        try:
            v = json.loads(self.read_body())
            if not isinstance(v, dict):
                raise ValueError()
            return v
        except (ValueError, UnicodeError):
            raise Problem('JSON 格式无效')

    def token(self):
        c = cookies.SimpleCookie()
        try:
            c.load(self.headers.get('Cookie', ''))
            return c['quadrant_session'].value if 'quadrant_session' in c else ''
        except cookies.CookieError:
            return ''

    def check_origin(self):
        origin = self.headers.get('Origin')
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise Problem('不允许跨站请求', 403)
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in ('http', 'https') or parsed.netloc != self.headers.get('Host'):
                raise Problem('不允许跨站请求', 403)

    def handle_request(self):
        try:
            path = unquote(urlsplit(self.path).path)
            method = self.command
            if method != 'GET':
                self.check_origin()
            if path == '/api/meta' and method == 'GET':
                with self.store.db() as db:
                    return self.reply({'initialized': bool(self.store.meta(db, 'auth')), 'name': self.store.meta(db, 'settings')['name'], 'authenticated': self.store.authenticated(self.token())})
            if path in ('/api/setup', '/api/login') and method == 'POST':
                token = self.store.login(self.json_body(), self.client_address[0], path.endswith('setup'))
                secure = '; Secure' if self.headers.get('Origin', '').startswith('https:') else ''
                return self.reply({'ok': True}, headers={'Set-Cookie': 'quadrant_session=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800' + secure})
            if path.startswith('/api/lan-sync/peer/') and method == 'POST':
                raw = self.read_body()
                try:
                    body = json.loads(raw)
                    if not isinstance(body, dict):
                        raise ValueError()
                except (ValueError, UnicodeError):
                    raise Problem('同步数据格式无效')
                sync = self.server.lan_sync
                if path.endswith('/pair'):
                    return self.reply(sync.pair(body))
                peer = sync.authenticate(path, raw, self.headers)
                with sync.lock:
                    sync.require_window()
                    if body.get('nonce') != sync.nonce:
                        raise Problem('同步窗口已失效，请重新同步', 409)
                    action = path.rsplit('/', 1)[1]
                    if action == 'prepare':
                        return self.reply(sync.prepare(peer, body))
                    if action == 'upload':
                        return self.reply(sync.transfer(peer, body, upload=True))
                    if action == 'download':
                        return self.reply(sync.transfer(peer, body))
                    if action == 'commit':
                        return self.reply(sync.commit(peer, body))
                    if action == 'ack':
                        return self.reply(sync.ack(peer, body))
                raise Problem('同步接口不存在', 404)
            if path.startswith('/api/'):
                if not self.store.authenticated(self.token()):
                    raise Problem('请先登录服务器', 401)
                if path == '/api/logout' and method == 'POST':
                    with self.store.db() as db:
                        db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(self.token().encode()).hexdigest(),))
                    return self.reply({'ok': True}, headers={'Set-Cookie': 'quadrant_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'})
                if path == '/api/state' and method == 'GET':
                    state = self.store.state()
                    state['addresses'] = self.server.addresses
                    return self.reply(state)
                if path == '/api/lan-sync/status' and method == 'GET':
                    return self.reply(self.server.lan_sync.status())
                if path == '/api/lan-sync/start' and method == 'POST':
                    return self.reply(self.server.lan_sync.start())
                if path == '/api/lan-sync/cancel' and method == 'POST':
                    return self.reply(self.server.lan_sync.cancel())
                if path == '/api/tasks' and method == 'POST':
                    return self.reply(self.store.create_task(self.json_body()), 201)
                if path.startswith('/api/tasks/') and path.endswith('/purge') and method == 'POST':
                    return self.reply(self.store.purge_task(path.split('/')[-2], self.json_body()))
                if path.startswith('/api/tasks/') and method in ('PATCH', 'DELETE'):
                    return self.reply(self.store.update_task(path.rsplit('/', 1)[1], self.json_body(), method == 'DELETE'))
                if path == '/api/timer' and method == 'POST':
                    return self.reply(self.store.timer_action(self.json_body()))
                if path == '/api/alarm-audio':
                    if method == 'POST':
                        try:
                            revision = int(self.headers.get('X-Alarm-Revision', '0'))
                        except ValueError:
                            raise Problem('提示音版本无效')
                        return self.reply(self.store.upload_alarm(unquote(self.headers.get('X-File-Name', '')), self.read_body(), self.headers.get('Content-Type', ''), revision))
                    if method == 'DELETE':
                        return self.reply(self.store.clear_alarm(self.json_body().get('revision')))
                    if method == 'GET':
                        with self.store.lock, self.store.db() as db:
                            config = self.store.row(db, 'alarm', ALARM_ID)
                            if not config['file_id']:
                                raise Problem('尚未上传自定义提示音', 404)
                            file = self.store.row(db, 'files', config['file_id'])
                            content_type = mimetypes.guess_type(file['name'])[0] or 'audio/mpeg'
                            if not content_type.startswith(('audio/', 'video/')):
                                content_type = 'application/octet-stream'
                            return self.send_bytes((self.store.path / 'attachments' / file['id']).read_bytes(), content_type)
                if path == '/api/settings' and method == 'PATCH':
                    return self.reply(self.store.update_settings(self.json_body()))
                if path == '/api/password' and method == 'POST':
                    body = self.json_body()
                    new = text_value(body.get('new_password', ''), '新密码', 128, True)
                    old_password = text_value(body.get('old_password', ''), '旧密码', 128, True)
                    if len(new) < 8:
                        raise Problem('新密码至少 8 位')
                    with self.store.lock, self.store.db() as db:
                        auth = self.store.meta(db, 'auth')
                        if not hmac.compare_digest(auth['hash'], password_hash(old_password, auth['salt'])):
                            raise Problem('旧密码不正确', 403)
                        salt = secrets.token_hex(16)
                        self.store.setmeta(db, 'auth', {'salt': salt, 'hash': password_hash(new, salt)})
                        db.execute('DELETE FROM sessions')
                    return self.reply({'ok': True})
                if path == '/api/upload' and method == 'POST':
                    return self.reply(self.store.upload(self.headers.get('X-Task-Id', ''), unquote(self.headers.get('X-File-Name', '')), self.read_body()), 201)
                if path.startswith('/api/files/'):
                    id_ = path.rsplit('/', 1)[1]
                    with self.store.lock, self.store.db() as db:
                        file = self.store.row(db, 'files', id_)
                        file_path = self.store.path / 'attachments' / file['id']
                        if method == 'GET':
                            if not file_path.is_file():
                                raise Problem('附件文件缺失', 404)
                            return self.send_bytes(file_path.read_bytes(), 'application/octet-stream', headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(file['name'])})
                        if method == 'DELETE':
                            db.execute('DELETE FROM files WHERE id=?', (id_,))
                            db.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")
                            file_path.unlink(missing_ok=True)
                            return self.reply({'ok': True})
                if path == '/api/export' and method == 'GET':
                    state = self.store.state()
                    state['format'] = 'quadrant-backup-v1'
                    return self.reply(state, headers={'Content-Disposition': 'attachment; filename="quadrant-data.json"'})
                if path == '/api/backup' and method == 'GET':
                    return self.send_bytes(self.store.backup(), 'application/zip', headers={'Content-Disposition': 'attachment; filename="quadrant-backup-' + date.today().isoformat() + '.zip"'})
                if path == '/api/import' and method == 'POST':
                    return self.reply(self.store.import_data(self.read_body()))
                raise Problem('接口不存在', 404)
            if method != 'GET':
                raise Problem('请求方法不支持', 405)
            target = (WEB / (path.lstrip('/') or 'index.html')).resolve()
            if WEB.resolve() not in target.parents or not target.is_file():
                raise Problem('页面不存在', 404)
            return self.send_bytes(target.read_bytes(), (mimetypes.guess_type(target.name)[0] or 'application/octet-stream') + ('; charset=utf-8' if target.suffix in ('.html', '.js', '.css', '.svg', '.webmanifest') else ''))
        except Problem as e:
            self.reply({'error': e.message}, e.status)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception:
            traceback.print_exc()
            try:
                self.reply({'error': '服务器处理失败，请查看服务器窗口中的日志'}, 500)
            except OSError:
                pass

    def do_GET(self):
        self.handle_request()

    do_POST = do_PATCH = do_DELETE = do_GET


def addresses(port):
    ips = {'127.0.0.1'}
    try:
        ips.update(v[4][0] for v in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    return ['http://' + ip + ':' + str(port) for ip in sorted(ips)]


def make_server(path, host='127.0.0.1', port=8765):
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.store = Store(path)
    server.addresses = addresses(server.server_port)
    server.lan_sync = LanSync(server.store, server.server_port, Problem, task_values)
    return server


def main():
    parser = argparse.ArgumentParser(description='象限 · 个人多端任务服务器')
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--data-dir', default=str(ROOT / 'data'))
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    try:
        server = make_server(args.data_dir, args.host, args.port)
    except OSError as e:
        print(f'启动失败：{e}\n请检查端口是否被占用。可用 --port 8766 指定其他端口。')
        return 1
    print('\n象限 · 数据保存在这台电脑\n')
    if not server.lan_sync.discovery():
        print('局域网发现端口 8767/UDP 被占用，手机手动同步暂不可用。')
    for address in server.addresses:
        print('  ' + address)
    print('\n数据目录：' + str(server.store.path))
    print('手机连接相同 Wi-Fi，打开上方非 127.0.0.1 的地址。\n首次使用请设置访问密码；按 Ctrl+C 停止服务器。\n')
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(f'http://127.0.0.1:{server.server_port}')).start()
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        print('\n服务器已停止。数据已保留。')
    finally:
        server.lan_sync.close()
        server.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
