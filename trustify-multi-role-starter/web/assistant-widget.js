(()=> {
  const btn = document.createElement('button');
  btn.setAttribute('aria-label','Assistant');
  btn.style.cssText = `
    position:fixed; right:20px; bottom:20px; z-index:9999;
    width:72px;height:72px;border-radius:50%;border:none;cursor:pointer;
    box-shadow:0 10px 30px rgba(0,0,0,.35); background:#ff4d00; display:flex;align-items:center;justify-content:center;
  `;
  btn.innerHTML = `<img src="/assets/bear.png" alt="" style="width:62px;height:62px;border-radius:50%">`;
  btn.onclick = ()=> location.href='/assistant.html';
  document.body.appendChild(btn);
})();
