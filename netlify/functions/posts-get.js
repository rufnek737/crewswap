'use strict';
/**
 * GET /.netlify/functions/posts-get
 * → Netlify Blobs에서 활성 포스트 전체 반환 (deleteToken 제외)
 */
const { getStore } = require('@netlify/blobs');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const store = getStore({ name: 'posts', consistency: 'strong', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
    const { blobs } = await store.list({ prefix: 'post:' });

    const posts = await Promise.all(
      blobs.map(async ({ key }) => {
        const data = await store.get(key, { type: 'json' });
        if (!data || data.status !== 'active') return null;
        // deleteToken은 클라이언트에 절대 전송하지 않음
        const { deleteToken, ...publicPost } = data;
        return publicPost;
      })
    );

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ posts: posts.filter(Boolean) }),
    };
  } catch (e) {
    console.error('posts-get error:', e);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
