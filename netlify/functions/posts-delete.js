'use strict';
/**
 * POST /.netlify/functions/posts-delete
 * body: { id, deleteToken }
 * → deleteToken 검증 후 Blobs에서 삭제
 */
const { getStore } = require('@netlify/blobs');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let id, deleteToken;
  try { ({ id, deleteToken } = JSON.parse(event.body || '{}')); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '잘못된 요청' }) }; }

  if (!id || !deleteToken) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '필수 필드 누락' }) };
  }

  try {
    const store = getStore({ name: 'posts', consistency: 'strong', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
    const post = await store.get(`post:${id}`, { type: 'json' });

    if (!post) {
      // 이미 없음 — 클라이언트는 로컬 정리 진행
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, alreadyGone: true }) };
    }
    if (post.deleteToken !== deleteToken) {
      return { statusCode: 403, headers: cors, body: JSON.stringify({ error: '권한 없음' }) };
    }

    await store.delete(`post:${id}`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('posts-delete error:', e);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
