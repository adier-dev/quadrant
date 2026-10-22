"""Manual, paired LAN synchronization. No WAN discovery or external services."""
from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import ipaddress
import json
import secrets
import socket
import threading
import time

DISCOVERY_PORT = 8767
PROTOCOL = 'quadrant-lan-v1'
TABLES = ('tasks', 'files', 'focus_logs', 'purged', 'alarm')
SCHEMA = 3


def canonical(value):
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in sorted(value.items()) if k != 'revision'}
    if isinstance(value, list):
        return [canonical(v) for v in value]
    return value


def same(a, b):
    return canonical(a) == canonical(b)


class LanSync:
    def __init__(self, store, port, problem, task_validator):
        self.Problem = problem
        self.task_validator = task_validator
        self.store, self.port = store, port
        self.lock = threading.RLock()
        self.deadline = 0
        self.code = ''
        self.nonce = ''
        self.phase = 'idle'
        self.message = '仅在两端按下按钮后同步'
        self.plan = None
        self.failures = 0
        self.socket = None
        self.stop_event = threading.Event()
        self._cleanup()
        with store.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS lan_peers (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            if not store.meta(db, 'device_id'):
                store.setmeta(db, 'device_id', secrets.token_hex(16))
            self.device_id = store.meta(db, 'device_id')

    def status(self):
        with self.lock:
            if self.deadline and time.monotonic() >= self.deadline:
                self._clear('未找到可同步的另一端或连接超时。请确认两端在同一局域网，且均已按下同步。', 'expired')
            return {'phase': self.phase, 'message': self.message, 'code': self.code,
                    'remaining': max(0, int(self.deadline - time.monotonic())) if self.deadline else 0,
                    'device_id': self.device_id, 'discovery_available': self.socket is not None}

    def _clear(self, message, phase='idle'):
        self._cleanup()
        self.deadline = 0
        self.code = self.nonce = ''
        self.phase, self.message = phase, message
        self.plan = None

    def start(self):
        with self.lock:
            if self.phase in ('syncing', 'conflict') and self.deadline > time.monotonic():
                raise self.Problem('正在同步，请等待完成或取消', 409)
            self.deadline = time.monotonic() + 120
            self.code = f'{secrets.randbelow(100000000):08d}'
            self.nonce = secrets.token_hex(16)
            self.phase = 'waiting'
            self.message = '请在手机端按下“同步”，等待时间为 2 分钟'
            self._cleanup()
            self.plan = None
            self.failures = 0
            return self.status()

    def cancel(self):
        with self.lock:
            self._clear('已停止同步，两端已保存的数据保持不变', 'cancelled')
            return self.status()

    def require_window(self):
        self.status()
        if self.phase not in ('waiting', 'syncing', 'conflict') or not self.deadline:
            raise self.Problem('电脑端未开启同步或等待已超时，请重新在两端按下同步', 409)

    def pair(self, body):
        with self.lock, self.store.db() as db:
            self.require_window()
            device = body.get('device_id', '')
            if not valid_id(device) or body.get('nonce') != self.nonce:
                raise self.Problem('设备或同步窗口无效', 403)
            if not hmac.compare_digest(str(body.get('code', '')), self.code):
                self.failures += 1
                if self.failures >= 5:
                    self._clear('配对码错误次数过多，已停止本轮同步', 'failed')
                raise self.Problem('配对码不正确，请输入电脑端显示的 8 位数字', 403)
            old = db.execute('SELECT 1 FROM lan_peers WHERE id=?', (device,)).fetchone()
            if old:
                raise self.Problem('此设备已配对；请先在手机上解除配对，再重新连接', 409)
            secret = secrets.token_hex(32)
            self.store.put(db, 'lan_peers', {'id': device, 'secret': secret, 'baseline': {}, 'pending': None})
            return {'secret': secret, 'desktop_id': self.device_id, 'protocol': PROTOCOL}

    def authenticate(self, path, raw, headers):
        device = headers.get('X-Quadrant-Device', '')
        with self.store.db() as db:
            row = db.execute('SELECT body FROM lan_peers WHERE id=?', (device,)).fetchone()
        if not row:
            raise self.Problem('设备未配对', 403)
        peer = json.loads(row['body'])
        signature = hmac.new(bytes.fromhex(peer['secret']), path.encode() + b'\n' + raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, headers.get('X-Quadrant-Signature', '')):
            raise self.Problem('同步校验失败', 403)
        return peer

    def snapshot(self, db):
        result = {table: self.store.rows(db, table) for table in TABLES}
        for f in result['files']:
            path = self.store.path / 'attachments' / f['id']
            if not path.is_file():
                raise self.Problem('电脑附件缺失，请先恢复附件再同步', 409)
            f['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        return result

    def validate(self, snapshot):
        if not isinstance(snapshot, dict):
            raise self.Problem('同步数据格式无效')
        for table in TABLES:
            rows = snapshot.get(table)
            if not isinstance(rows, list) or len(rows) > (20000 if table == 'focus_logs' else 10000):
                raise self.Problem('同步记录数量超出限制')
            seen = set()
            for row in rows:
                if not isinstance(row, dict) or not valid_id(row.get('id'), task=table in ('tasks', 'purged')) or row['id'] in seen:
                    raise self.Problem('同步记录编号无效或重复')
                seen.add(row['id'])
                if table == 'purged':
                    if type(row.get('deleted_at')) is not int or row['deleted_at'] < 0:
                        raise self.Problem('永久删除标记无效')
                elif table == 'alarm':
                    if row['id'] != '0'*32 or len(rows) != 1 or type(row.get('revision')) is not int or row['revision'] < 1:
                        raise self.Problem('提示音配置无效')
                    if row.get('file_id') and not valid_id(row['file_id']):
                        raise self.Problem('提示音文件编号无效')
                    if type(row.get('updated_at')) is not int or row['updated_at'] < 0:
                        raise self.Problem('提示音配置时间无效')
                elif table == 'tasks':
                    values = self.task_validator(row)
                    values.update({k: row[k] for k in ('id', 'revision', 'created_at', 'updated_at', 'completed_at', 'deleted_at') if k in row})
                    row.clear()
                    row.update(values)
                    if type(row.get('revision')) is not int or row['revision'] < 1:
                        raise self.Problem('任务版本无效')
                    for key in ('created_at', 'updated_at', 'completed_at', 'deleted_at'):
                        v = row.get(key)
                        if v is not None and (type(v) is not int or not 0 <= v <= 32503680000000):
                            raise self.Problem('任务时间无效')
                elif table == 'files':
                    alarm_file = row.get('kind') == 'alarm'
                    if (not alarm_file and not valid_id(row.get('task_id'), task=True)) or (alarm_file and row.get('task_id') != '') or type(row.get('size')) is not int or not 0 < row['size'] <= 20*1024*1024:
                        raise self.Problem('附件元数据无效')
                    if not isinstance(row.get('name'), str) or not row['name'].strip() or len(row['name']) > 200:
                        raise self.Problem('附件名称无效')
                    digest = row.get('sha256', '')
                    if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
                        raise self.Problem('附件摘要无效')
                else:
                    if type(row.get('duration')) is not int or not 1 <= row['duration'] <= 86400 or type(row.get('finished_at')) is not int:
                        raise self.Problem('专注记录无效')
                    if not isinstance(row.get('task_id', ''), str) or len(row.get('task_id', '')) > 100:
                        raise self.Problem('专注关联任务无效')
        task_ids = {t['id'] for t in snapshot['tasks']}
        if len(snapshot['alarm']) != 1:
            raise self.Problem('提示音配置缺失，请更新两端软件后重新同步')
        counts = {}
        for f in snapshot['files']:
            if f.get('kind') == 'alarm':
                continue
            if f['task_id'] not in task_ids:
                raise self.Problem('附件关联任务不存在')
            counts[f['task_id']] = counts.get(f['task_id'], 0) + 1
        if any(n > 12 for n in counts.values()) or sum(f['size'] for f in snapshot['files']) > 256*1024*1024:
            raise self.Problem('附件数量或总容量超出同步限制（每任务 12 个、总计 256 MB）')
        selected = snapshot['alarm'][0]['file_id'] if snapshot['alarm'] else ''
        if selected and not any(f['id'] == selected and f.get('kind') == 'alarm' for f in snapshot['files']):
            raise self.Problem('提示音文件缺失')

    def prepare(self, peer, body):
        ident = lambda: secrets.token_hex(16)
        now = lambda: int(time.time()*1000)
        with self.lock, self.store.lock, self.store.db() as db:
            self.require_window()
            if body.get('sync_schema') != SCHEMA:
                raise self.Problem('同步协议已升级，请同时更新安卓安装包和电脑端，使用精简后的任务格式', 409)
            self.store.advance_timer()
            remote = body.get('snapshot')
            self.validate(remote)
            local = self.snapshot(db)
            baseline = peer.get('baseline', {})
            purged = {row['id']: row for row in local['purged'] + remote['purged']}
            for snapshot in [local, remote]:
                snapshot['tasks'] = [t for t in snapshot['tasks'] if t['id'] not in purged]
                snapshot['files'] = [f for f in snapshot['files'] if f.get('task_id') not in purged]
            choices = body.get('choices', {})
            if not isinstance(choices, dict):
                raise self.Problem('冲突选择格式无效')
            if choices and body.get('conflict_revision') != self.store.meta(db, 'revision'):
                raise self.Problem('电脑上的任务在冲突处理期间又有修改，请重新同步后选择', 409)
            result, conflicts = {}, []
            for table in TABLES:
                left = {r['id']: r for r in local[table]}
                right = {r['id']: r for r in remote[table]}
                base = {r['id']: r for r in baseline.get(table, [])}
                merged = {}
                for id_ in sorted(left.keys() | right.keys() | base.keys()):
                    a, b, ancestor = left.get(id_), right.get(id_), base.get(id_)
                    if same(a, b) or same(b, ancestor):
                        chosen = a
                    elif same(a, ancestor):
                        chosen = b
                    elif table in ('tasks', 'alarm') and a and b:
                        key = id_ if table == 'tasks' else 'alarm:' + id_
                        choice = choices.get(key)
                        allowed = ('desktop', 'phone', 'both') if table == 'tasks' else ('desktop', 'phone')
                        if choice not in allowed:
                            if table == 'alarm':
                                def description(row, snapshot):
                                    file = next((f for f in snapshot['files'] if f['id'] == row['file_id']), None)
                                    return {'title': file['name'] if file else '默认提示音', 'notes': ''}
                                conflicts.append({'id': key, 'kind': 'alarm', 'desktop': description(a, local), 'phone': description(b, remote)})
                            else:
                                conflicts.append({'id': key, 'kind': 'task', 'desktop': a, 'phone': b})
                            continue
                        chosen = a if choice != 'phone' else b
                        if choice == 'both':
                            extra = copy.deepcopy(b)
                            extra.update(id=ident(), title=(b['title'][:480] + '（手机冲突副本）'), revision=1,
                                         created_at=now(), updated_at=now())
                            merged[extra['id']] = extra
                    else:
                        # Immutable attachments/logs: retain an extant edited record.
                        chosen = a or b
                    if chosen is not None:
                        chosen = copy.deepcopy(chosen)
                        if table in ('tasks', 'alarm'):
                            chosen['revision'] = a['revision'] if a and same(a, chosen) else (a['revision'] + 1 if a else 1)
                        merged[id_] = chosen
                result[table] = list(merged.values())
            result['purged'] = list(purged.values())
            result['tasks'] = [t for t in result['tasks'] if t['id'] not in purged]
            selected = result['alarm'][0]['file_id'] if result['alarm'] else ''
            result['files'] = [f for f in result['files'] if f.get('task_id') not in purged and (f.get('kind') != 'alarm' or f['id'] == selected)]
            if conflicts:
                self.phase, self.message = 'conflict', f'请在手机上处理 {len(conflicts)} 项更新冲突'
                self.deadline = time.monotonic() + 300
                return {'conflicts': conflicts, 'conflict_revision': self.store.meta(db, 'revision')}
            self.validate(result)
            # Repeated prepare safely replaces only an uncommitted in-memory plan.
            self._cleanup()
            self.plan = {'id': ident(), 'peer': peer['id'], 'snapshot': result,
                         'revision': self.store.meta(db, 'revision'), 'blobs': {}}
            self.phase, self.message = 'syncing', '正在交换任务、附件与专注记录'
            self.deadline = time.monotonic() + 300
            files = {f['id']: f for f in local['files']}
            missing = [f['id'] for f in result['files'] if f['id'] not in files or files[f['id']]['sha256'] != f['sha256']]
            return {'plan_id': self.plan['id'], 'snapshot': result, 'upload': missing, 'conflicts': []}

    def require_plan(self, peer, body):
        self.require_window()
        if not self.plan or self.plan['id'] != body.get('plan_id') or self.plan['peer'] != peer['id']:
            raise self.Problem('同步会话已失效，请重新在两端按下同步', 409)
        self.deadline = time.monotonic() + 300
        return self.plan

    def transfer(self, peer, body, upload=False):
        with self.lock, self.store.lock:
            plan = self.require_plan(peer, body)
            file = next((f for f in plan['snapshot']['files'] if f['id'] == body.get('id')), None)
            if not file:
                raise self.Problem('附件不在本次同步范围内', 404)
            if upload:
                try:
                    data = base64.b64decode(body.get('data', ''), validate=True)
                except (ValueError, TypeError):
                    raise self.Problem('附件编码无效')
                if len(data) != file['size'] or hashlib.sha256(data).hexdigest() != file['sha256']:
                    raise self.Problem('附件校验不一致，已停止写入', 409)
                # Bounded temporary files are kept only in this device's data folder.
                staging = self.store.path / 'sync-staging'
                staging.mkdir(exist_ok=True)
                path = staging / (plan['id'] + '-' + file['id'])
                path.write_bytes(data)
                plan['blobs'][file['id']] = path
                return {'ok': True}
            path = plan['blobs'].get(file['id'])
            if not path or not path.is_file():
                path = self.store.path / 'attachments' / file['id']
            if not path.is_file():
                raise self.Problem('附件尚未传输', 409)
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != file['sha256']:
                raise self.Problem('附件校验失败', 409)
            return {'data': base64.b64encode(data).decode()}

    def commit(self, peer, body):
        with self.lock, self.store.lock:
            self.require_window()
            with self.store.db() as db:
                current = self.store.row(db, 'lan_peers', peer['id'])
                pending = current.get('pending')
                if pending and pending['id'] == body.get('plan_id'):
                    return {'ok': True, 'snapshot': pending['snapshot']}
            plan = self.require_plan(peer, body)
            with self.store.write() as db:
                if self.store.meta(db, 'revision') != plan['revision']:
                    raise self.Problem('电脑数据在同步期间发生变化，请重新同步；两端修改均已保留', 409)
                old_files = self.store.rows(db, 'files')
                referenced = {file['id'] for file in old_files}
                for file in plan['snapshot']['files']:
                    target = self.store.path / 'attachments' / file['id']
                    source = plan['blobs'].get(file['id'])
                    if file['id'] in referenced and target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != file['sha256']:
                        raise self.Problem('附件编号冲突，已停止同步', 409)
                    candidate = source if source and source.is_file() else target
                    if not candidate.is_file() or hashlib.sha256(candidate.read_bytes()).hexdigest() != file['sha256']:
                        raise self.Problem('附件未完整传输，未提交同步', 409)
                # Validate every blob before publishing any. Atomic renames also let
                # a retry repair an unreferenced file left by an interrupted commit.
                for file in plan['snapshot']['files']:
                    source = plan['blobs'].get(file['id'])
                    if source and source.is_file():
                        source.replace(self.store.path / 'attachments' / file['id'])
                for table in TABLES:
                    db.execute('DELETE FROM ' + table)
                    for row in plan['snapshot'][table]:
                        value = {k: v for k, v in row.items() if k != 'sha256'} if table == 'files' else row
                        self.store.put(db, table, value)
                current['pending'] = {'id': plan['id'], 'snapshot': plan['snapshot']}
                self.store.put(db, 'lan_peers', current)
            live = {f['id'] for f in plan['snapshot']['files']}
            for file in old_files:
                if file['id'] not in live:
                    (self.store.path / 'attachments' / file['id']).unlink(missing_ok=True)
            self.message = '电脑已保存，等待手机确认'
            return {'ok': True, 'snapshot': plan['snapshot']}

    def ack(self, peer, body):
        with self.lock, self.store.db() as db:
            self.require_window()
            current = self.store.row(db, 'lan_peers', peer['id'])
            pending = current.get('pending')
            if not pending or pending['id'] != body.get('plan_id'):
                raise self.Problem('同步确认已过期，请重新同步', 409)
            current['baseline'] = pending['snapshot']
            current['pending'] = None
            self.store.put(db, 'lan_peers', current)
            self.store.setmeta(db, 'lan_sync_last', int(time.time()*1000))
            self._cleanup()
            self._clear('同步完成，任务、附件和专注记录已在两端保存', 'done')
            return {'ok': True}

    def _cleanup(self):
        staging = self.store.path / 'sync-staging'
        if staging.exists():
            for path in staging.iterdir():
                if path.is_file():
                    path.unlink(missing_ok=True)

    def discovery(self, port=DISCOVERY_PORT):
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            udp.bind(('0.0.0.0', port))
        except OSError:
            udp.close()
            return False
        udp.settimeout(.5)
        self.socket = udp
        def run():
            while not self.stop_event.is_set():
                try:
                    data, sender = udp.recvfrom(1024)
                    request = json.loads(data)
                    with self.lock:
                        status = self.status()
                        if request.get('protocol') != PROTOCOL or status['phase'] != 'waiting':
                            continue
                        if request.get('desktop_id') and request['desktop_id'] != self.device_id:
                            continue
                        addr = ipaddress.ip_address(sender[0])
                        if not (addr.is_private or addr.is_link_local):
                            continue
                        response = {'protocol': PROTOCOL, 'sync_schema': SCHEMA, 'desktop_id': self.device_id, 'port': self.port,
                                    'nonce': self.nonce, 'request_id': request.get('request_id', '')}
                        udp.sendto(json.dumps(response).encode(), sender)
                except (socket.timeout, ValueError, TypeError, AttributeError):
                    continue
                except OSError:
                    break
        threading.Thread(target=run, daemon=True, name='quadrant-lan-discovery').start()
        return True

    def close(self):
        self.stop_event.set()
        if self.socket:
            self.socket.close()
            self.socket = None
        self._cleanup()


def valid_id(value, task=False):
    if not isinstance(value, str):
        return False
    if task:
        return 0 < len(value) <= 100 and all(c.isascii() and (c.isalnum() or c in '-_') for c in value)
    return len(value) == 32 and all(c in '0123456789abcdef' for c in value)
