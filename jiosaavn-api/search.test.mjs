import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './api/search/songs.js';

async function request(query) {
    const output = {};
    await handler({ method: 'GET', query }, {
        setHeader() {},
        status(code) { output.code = code; return this; },
        json(body) { output.body = body; },
    });
    return output;
}

test('adapts upstream search to the M14U catalog format', async t => {
    t.mock.method(globalThis, 'fetch', async url => {
        assert.equal(new URL(url).searchParams.get('q'), 'a & b');
        assert.equal(new URL(url).searchParams.get('n'), '3');
        return Response.json({ results: [{ type: 'song', id: 'song-1', title: 'Hello', image: 'https://c.saavncdn.com/image' }] });
    });
    const result = await request({ query: 'a & b', limit: '3' });
    assert.equal(result.code, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.results[0].name, 'Hello');
});

test('rejects invalid parameters and converts upstream failures to 502', async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
    assert.equal((await request({ query: 'test', limit: '1&extra=1' })).code, 400);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal((await request({ query: 'test' })).code, 502);
});
