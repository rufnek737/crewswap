'use strict';
/**
 * POST /.netlify/functions/posts-create
 * body: post 객체 (deleteToken 포함)
 * → Netlify Blobs에 저장, { id } 반환
 */
const { getStore } = require('@netlify/blobs');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const ALLOWED = [
  'id','deleteToken','registeredAt',
  'airline','crewType','ownerRole','ownerNick','ownerRating','ownerBase',
  'offered','wanted',
  'deadlineDay','watchers','status','creditSpent',
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let post;
  try { post = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '잘못된 요청' }) }; }

  if (!post.id || !post.deleteToken || !post.offered || !post.wanted) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '필수 필드 누락' }) };
  }

  // 허용된 필드만 저장
  const clean = {};
  ALLOWED.forEach(k => { if (post[k] !== undefined) clean[k] = post[k]; });
  clean.status = 'active';
  clean.registeredAt = clean.registeredAt || new Date().toISOString();

  try {
    const store = getStore({ name: 'posts', consistency: 'strong' });
    await store.setJSON(`post:${clean.id}`, clean);
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ id: clean.id }),
    };
  } catch (e) {
    console.error('posts-create error:', e);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
