// CrewSwap Service Worker
const CACHE = 'crewswap-v226';
const SHELL = ['./index.html', './styles.css?v=226', './credit-policy.js?v=226', './post-dates.js?v=226', './schedule-continuity.js?v=226', './request-disclosure.js?v=226', './swap-usage.js?v=226', './post-history.js?v=226', './roster-sync.js?v=226', './post-details.js?v=226', './mogiji-policy.js?v=226', './cabin-policy.js?v=226', './release-notice.js?v=226', './selection-flow.js?v=226', './airport-aliases.js?v=226', './grade-policy.js?v=226', './crew-seniority.js?v=226', './duty-window.js?v=226', './activity-codes.js?v=226', './duty-limits.js?v=226', './rest-window.js?v=226', './app.js?v=226', './manifest.json', './privacy.html', './terms.html', './support.html'];

// 설치 — 앱 쉘 캐시
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

// 활성화 — 구버전 캐시 삭제
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 요청 처리
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API 호출 — 항상 네트워크 우선 (오프라인 시 빈 응답).
  // 예전에는 '/.netlify/functions/'를 보고 있었는데 API가 Cloudflare Worker로
  // 옮겨간 뒤로 이 분기에 아무것도 걸리지 않았다. 그 결과 posts-get·requests-get
  // 같은 GET API 응답이 아래 캐시 우선 분기에 걸려 한 번 캐시되면 계속 옛 목록이
  // 나왔다. 호스트가 아니라 '/api/' 경로로 판단해 다시 옮겨가도 깨지지 않게 한다.
  if (url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // 페이지(index.html) — 네트워크 우선. 캐시 우선이면 업데이트 후 첫 접속에 옛 화면이
  // 떠서, 새로고침을 몇 번 해야 새 기능이 보였다(2026-11-21 Kay). 오프라인이면 캐시.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', clone)); }
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 앱 쉘(js·css) — 캐시 우선. 파일 주소에 ?v= 버전이 붙어 있어 새 index.html 이 새 파일을 부른다.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

// PRO 저장조건 백그라운드 알림 — 탭이 닫혀 있어도 Push API가 이 이벤트를 전달한다.
self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || '듀티스왑', {
    body: data.body || '조건에 맞는 새 스왑이 올라왔습니다.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'crewswap-premium-alert',
    data: data.data || { url: './#find' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || './#find';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      if ('navigate' in existing) existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
