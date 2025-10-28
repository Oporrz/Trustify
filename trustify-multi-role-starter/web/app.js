/* ===== Trustify app.js ===== */

// ใช้ origin เดียวกับเว็บ (ทำงานผ่านโดเมนจริง/Cloudflare ได้)
(() => {
  const sameOrigin = `${location.protocol}//${location.host}`;
  try { localStorage.setItem('backend_url', sameOrigin); } catch {}
})();
window.CFG = { BACKEND_URL: (localStorage.getItem('backend_url') || "") };

// เปลี่ยน backend เองตอน dev ได้
window.setBackend = (url) => { localStorage.setItem('backend_url', url); window.CFG.BACKEND_URL = url; };

// API helper
window.API = (path, opts={}) => fetch((window.CFG.BACKEND_URL||"") + path, opts);

// Geo
window.getGeo = () => new Promise((resolve)=>{
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (pos)=> resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    ()=> resolve(null),
    { enableHighAccuracy:true, timeout:2500 }
  );
});

// Toast (ต้องมี <div id="toast"> ในหน้า)
window.toast = (msg, ms=2500) => {
  const el = document.getElementById('toast');
  if (!el) return alert(msg);
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> el.style.display='none', ms);
};

// Browser notifications
window.notify = async (title, body) => {
  try {
    if (Notification.permission === 'granted') return new Notification(title, { body });
    if (Notification.permission !== 'denied') {
      const p = await Notification.requestPermission();
      if (p === 'granted') new Notification(title, { body });
    }
  } catch {}
};

// Points
window.renderPoints = () => {
  const el = document.querySelector('[data-points]');
  const p = parseInt(localStorage.getItem('points') || '0', 10);
  if (el) el.textContent = p;
};
window.addPoint = (n=1) => {
  const p = parseInt(localStorage.getItem('points') || '0', 10) + n;
  localStorage.setItem('points', p);
  window.renderPoints();   // ✅ แก้จาก renderPoints() เป็น window.renderPoints()
};

// Register Service Worker + Push
(async function registerPush(){
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.register('/sw.js');

    let perm = Notification.permission;
    if (perm !== 'granted') perm = await Notification.requestPermission();
    if (perm !== 'granted') return;

    // โหลด VAPID public (จาก /app.vapid.js ที่ server ฉีดค่าให้)
    await import('/app.vapid.js');
    const vapidKey = window.__VAPID || '';
    if (!vapidKey) {
      console.warn('⚠️ No VAPID key found'); 
      return;
    }

    const conv = (base64) => {
      const padding = '='.repeat((4 - base64.length % 4) % 4);
      const base64s = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = atob(base64s);
      const outputArray = new Uint8Array(rawData.length);
      for (let i=0;i<rawData.length;i++) outputArray[i] = rawData.charCodeAt(i);
      return outputArray;
    };

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: conv(vapidKey)
    });

    await API('/api/push/subscribe', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(sub)
    });
    console.log('✅ Push subscribed');
  } catch (e) {
    console.warn('Push subscribe failed:', e);
  }
})();
