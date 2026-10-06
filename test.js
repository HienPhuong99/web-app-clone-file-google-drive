'use strict';
// Integration test: boots the app on a temp data dir and exercises the main flows.
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-test-'));
process.env.QUOTA_BYTES = String(1024 * 1024);
const { app } = require('./server');

const srv = app.listen(0, async () => {
  const base = `http://localhost:${srv.address().port}`;
  const jar = {};
  const call = async (m, u, body, { raw, cookie = jar } = {}) => {
    const h = {}; if (cookie.c) h.cookie = cookie.c;
    let b = body; if (body && !(body instanceof FormData)) { h['content-type'] = 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(base + u, { method: m, headers: h, body: b, redirect: 'manual' });
    const sc = r.headers.getSetCookie?.()[0]; if (sc) cookie.c = [cookie.c, sc.split(';')[0]].filter(Boolean).join('; ');
    if (raw) return r;
    return Object.assign(await r.json().catch(() => ({})), { _status: r.status });
  };
  const up = (name, content, extra = {}, type = 'text/plain') => { const fd = new FormData(); for (const [k, v] of Object.entries(extra)) fd.append(k, v); fd.append('file', new Blob([content], { type }), name); return call('POST', '/api/upload', fd); };
  try {
    assert.equal((await call('GET', '/api/files'))._status, 401, 'auth required');
    assert.equal((await call('POST', '/api/register', { email: 'a@b.co', password: 'short' }))._status, 400);
    assert.equal((await call('POST', '/api/register', { email: 'a@b.co', password: 'password123' }))._status, 200);
    assert.equal((await call('POST', '/api/login', { email: 'a@b.co', password: 'nope' }, { cookie: {} }))._status, 401);

    const folder = await call('POST', '/api/folders', { name: 'Docs' });
    const f1 = await up('hello.txt', 'xin chao the gioi', { parent_id: folder.id });
    const dup = await up('hello.txt', 'again', { parent_id: folder.id });
    assert.equal(dup.name, 'hello (1).txt', 'duplicate names are renamed');
    const nested = await up('x.txt', 'nested', { parent_id: folder.id, rel_path: 'sub/deep/x.txt' });
    assert.ok(nested.id);
    let list = await call('GET', `/api/files?parent=${folder.id}`);
    assert.deepEqual(list.files.map((f) => f.name), ['sub', 'hello (1).txt', 'hello.txt']);

    assert.equal((await call('GET', '/api/files?search=th%E1%BA%BF')).files.length, 0);
    assert.equal((await call('GET', '/api/files?search=chao')).files[0].id, f1.id, 'content search');

    // move guard + rename
    assert.equal((await call('PATCH', `/api/files/${folder.id}`, { parent_id: list.files[0].id }))._status, 400, 'cannot move into own descendant');
    assert.equal((await call('PATCH', `/api/files/${f1.id}`, { name: 'renamed.txt', starred: true })).name, 'renamed.txt');
    assert.equal((await call('GET', '/api/files?view=starred')).files.length, 1);

    // content: inline text served safely, html never inline
    const raw = await call('GET', `/api/files/${f1.id}/content?inline=1`, null, { raw: true });
    assert.equal(await raw.text(), 'xin chao the gioi'); assert.match(raw.headers.get('content-security-policy'), /sandbox/);
    const html = await up('evil.html', '<script>1</script>', {}, 'text/html'); const hr = await call('GET', `/api/files/${html.id}/content?inline=1`, null, { raw: true });
    assert.match(hr.headers.get('content-disposition'), /^attachment/);

    // versions
    const v = new FormData(); v.append('file', new Blob(['version two'], { type: 'text/plain' }), 'ignored.txt');
    await call('POST', `/api/files/${f1.id}/versions`, v);
    let vs = await call('GET', `/api/files/${f1.id}/versions`); assert.equal(vs.versions.length, 2);
    await call('POST', `/api/files/${f1.id}/versions/${vs.versions[1].id}/restore`);
    assert.equal(await (await call('GET', `/api/files/${f1.id}/content`, null, { raw: true })).text(), 'xin chao the gioi');

    // quota
    assert.equal((await up('big.bin', Buffer.alloc(2 * 1024 * 1024)))._status, 413);

    // sharing with password
    let sh = await call('PUT', `/api/files/${f1.id}/share`, { password: 'secret1' });
    const anon = {};
    assert.equal((await call('GET', `/api/s/${sh.token}`, null, { cookie: anon })).locked, true);
    assert.equal((await call('GET', `/api/s/${sh.token}/content?id=${f1.id}`, null, { cookie: anon }))._status, 401);
    assert.equal((await call('POST', `/api/s/${sh.token}/unlock`, { password: 'bad' }, { cookie: anon }))._status, 401);
    await call('POST', `/api/s/${sh.token}/unlock`, { password: 'secret1' }, { cookie: anon });
    assert.equal((await call('GET', `/api/s/${sh.token}`, null, { cookie: anon })).root.name, 'renamed.txt');
    // folder share: can reach descendants only
    const fs2 = await call('PUT', `/api/files/${folder.id}/share`, {});
    const l2 = await call('GET', `/api/s/${fs2.token}/list`, null, { cookie: {} }); assert.equal(l2.files.length, 3);
    assert.equal((await call('GET', `/api/s/${fs2.token}/content?id=${html.id}`, null, { cookie: {} }))._status, 404, 'outside shared folder');
    await call('DELETE', `/api/files/${f1.id}/share`);
    assert.equal((await call('GET', `/api/s/${sh.token}`, null, { cookie: {} }))._status, 404);

    // zip
    const z = await call('GET', `/api/zip?ids=${folder.id}`, null, { raw: true }); const zb = Buffer.from(await z.arrayBuffer());
    assert.equal(zb.subarray(0, 2).toString(), 'PK'); assert.ok(zb.includes('sub/deep/x.txt'));

    // trash / restore / purge
    await call('POST', `/api/files/${folder.id}/trash`);
    assert.equal((await call('GET', '/api/files?view=trash')).files.length, 1, 'only top-level trashed item listed');
    assert.equal((await call('DELETE', `/api/files/${f1.id}`))._status, 200, 'child purge allowed when trashed');
    await call('POST', `/api/files/${folder.id}/restore`);
    assert.equal((await call('GET', `/api/files?parent=${folder.id}`)).files.length, 2);
    await call('POST', `/api/files/${folder.id}/trash`); await call('DELETE', '/api/trash');
    assert.equal((await call('GET', '/api/me')).used, (await call('GET', '/api/me')).used);
    const me = await call('GET', '/api/me'); assert.equal(me.used, 18, 'only evil.html remains'); // 18 bytes

    // isolation between users
    const other = {}; await call('POST', '/api/register', { email: 'c@d.co', password: 'password123' }, { cookie: other });
    assert.equal((await call('GET', `/api/files/${html.id}/content`, null, { cookie: other, raw: true })).status, 404);
    console.log('All tests passed');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { srv.close(); setTimeout(() => process.exit(), 100); }
});
