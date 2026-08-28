/* DPRO ESTHE Tutorial injection service worker / R3 V1.1 */
const VERSION='ESTHE-R3-SW-20260828';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.mode!=='navigate') return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin || url.searchParams.get('dpro_tutorial')!=='1') return;
  event.respondWith((async()=>{
    const res=await fetch(req);
    const type=res.headers.get('content-type')||'';
    if(!res.ok || !type.includes('text/html')) return res;
    let html=await res.text();
    if(!html.includes('data-dpro-tutorial-r3')) {
      const headTag='<link data-dpro-tutorial-r3 rel="stylesheet" href="tutorial.css?v=ESTHE-R3-V1.1-20260828">';
      const bodyTag='<script data-dpro-tutorial-r3 src="tutorial.js?v=ESTHE-R3-V1.1-20260828"><\/script>';
      html=html.includes('</head>')?html.replace('</head>',headTag+'</head>'):headTag+html;
      html=html.includes('</body>')?html.replace('</body>',bodyTag+'</body>'):html+bodyTag;
    }
    const headers=new Headers(res.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('cache-control','no-store');
    headers.set('x-dpro-tutorial-sw',VERSION);
    return new Response(html,{status:res.status,statusText:res.statusText,headers});
  })());
});
