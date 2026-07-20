// CrewSwap Service Worker
const CACHE = 'crewswap-v68';
const SHELL = ['./index.html', './styles.css', './post-dates.js', './app.js', './manifest.json'];

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

  // Netlify Functions — 네트워크 우선 (오프라인 시 빈 응답)
  if (url.includes('/.netlify/functions/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // 앱 쉘 — 캐시 우선, 없으면 네트워크
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
  event.waitUntil(self.registration.showNotification(data.title || 'CrewSwap', {
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
