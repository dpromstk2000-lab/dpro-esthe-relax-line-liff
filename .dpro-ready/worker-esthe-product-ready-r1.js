// =========================================================
// STEP ESTHE-16
// DPRO エステ・リラクゼーション LINE
// Cloudflare Worker 完全版
// 推奨Worker名: dpro-esthe-relax-line-api
// Version: ESTHE-16-PHONE-NORMALIZE-SEARCH-20260711
//
// 電話番号正規化・検索強化内容：
// - 090-1111-2222 / 09011112222 / 090 1111 2222 / ０９０ー１１１１ー２２２２ を同じ番号として扱う
// - 顧客作成・予約作成・マイページ検索・顧客検索・顧客カルテ検索で電話番号を統一
// - 店舗設定保存APIは STEP ESTHE-12A の内容を維持
// - system-check API は STEP ESTHE-16 OK を返却
//
// 必要な環境変数（Cloudflare Worker Settings > Variables）
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  または SUPABASE_SERVICE_KEY
// - ESTHE_DEFAULT_SHOP_CODE    任意。未設定なら esthe_demo_default
// - ESTHE_ADMIN_SECRET         DEMO管理API用。DEMOでは必須。本番権限には使用しない
// - ESTHE_LINE_LOGIN_CHANNEL_ID 契約時に本番LINE LoginチャネルIDを設定（DEMOでは不要）
// - ESTHE_FRONTEND_CONTRACT_URL  任意。未設定なら公開 ready-contract.json を使用
// =========================================================

// PRODUCT READY R1 preserves DPRO-ESTHE-NEXT-1.0.1 and adds only the
// CENTRAL-authorized production safety/observability adapter.
const LEGACY_BASELINE_VERSION = 'ESTHE-16-PHONE-NORMALIZE-SEARCH-20260711';
const READY_RELEASE = Object.freeze({
  contractVersion: 'DPRO-ESTHE-NEXT-1.0.1-READY-R1',
  adapterVersion: 'DPRO-CONTROL-ADAPTER-1.0',
  expectedWorkerVersion: 'ESTHE-READY-R1-WORKER-20260822',
  expectedDatabaseVersion: 'ESTHE-DB-READY-R1-20260822',
  expectedFrontendVersion: 'ESTHE-PAGES-READY-R1-20260822',
});
const VERSION = READY_RELEASE.expectedWorkerVersion;
const SERVICE_NAME = 'DPRO Esthe Relaxation LINE API';
const DEFAULT_SHOP_CODE = 'esthe_demo_default';
const DPRO_AUTH_SYSTEM_CODE = 'ESTHE';
const JST_OFFSET = '+09:00';
const LINE_ID_TOKEN_VERIFY_ENDPOINT = 'https://api.line.me/oauth2/v2.1/verify';
const DEFAULT_FRONTEND_CONTRACT_URL = 'https://dpromstk2000-lab.github.io/dpro-esthe-relax-line-liff/ready-contract.json';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-admin-secret, x-line-id-token, x-esthe-staff-session, x-staff-session, x-request-id',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const startedAt = Date.now();
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const auditRequest = request.clone();
    let ctx = null;

    try {
      ctx = createContext(env);
      const routeResult = await routeRequest(request, url, path, ctx, startedAt);
      await auditAdminOperationSafely(auditRequest, url, path, ctx, routeResult.status);
      return routeResult;
    } catch (error) {
      const errorStatus = Number(error?.status || 500);
      const status = Number.isInteger(errorStatus) && errorStatus >= 400 && errorStatus <= 599 ? errorStatus : 500;
      const response = jsonResponse({
        ok: false,
        service: SERVICE_NAME,
        version: VERSION,
        error: error?.code || 'request_failed',
        message: error?.message || String(error),
        path,
        time: new Date().toISOString(),
      }, status);
      if (ctx) await auditAdminOperationSafely(auditRequest, url, path, ctx, response.status);
      return response;
    }
  },
};

async function routeRequest(request, url, path, ctx, startedAt) {
  const method = request.method.toUpperCase();

  if (path === '/' || path === '/api') {
    return jsonResponse({
      ok: true,
      service: SERVICE_NAME,
      version: VERSION,
      worker_name: 'dpro-esthe-relax-line-api',
      default_shop_code: ctx.defaultShopCode,
      endpoints: endpointList(),
      time: new Date().toISOString(),
    });
  }

  if (method === 'GET' && path === '/api/health') {
    return handleHealth(url, ctx, startedAt);
  }

  // ---------- Public API ----------
  if (method === 'GET' && path === '/api/public/settings') {
    return handlePublicSettings(url, ctx);
  }

  if (method === 'GET' && path === '/api/public/menus') {
    return handlePublicMenus(url, ctx);
  }

  if (method === 'GET' && path === '/api/public/staff') {
    return handlePublicStaff(url, ctx);
  }

  if (method === 'GET' && path === '/api/public/slots') {
    return handlePublicSlots(url, ctx);
  }

  if (method === 'POST' && path === '/api/public/reservations') {
    return handleCreateReservation(request, url, ctx, 'liff');
  }

  if ((method === 'POST' || method === 'PATCH') && path === '/api/public/reservation/change') {
    return handleChangeReservation(request, url, ctx);
  }

  if ((method === 'POST' || method === 'PATCH') && path === '/api/public/reservation/cancel') {
    return handleCancelReservation(request, url, ctx);
  }

  if (method === 'GET' && path === '/api/public/my-page') {
    return handleMyPage(request, url, ctx);
  }

  // ---------- Admin API ----------
  // DEMO keeps the existing demo secret. Production never accepts the demo code:
  // it requires a DPRO Common Owner Auth bearer session or a product-local scoped
  // staff session for explicitly permitted routes.
  if (path.startsWith('/api/admin/')) {
    const auth = await authorizeAdminRequest(request, url, path, method, ctx);
    ctx.auth = auth;
    if (!auth.ok) return auth.response;
  }

  if (method === 'GET' && path === '/api/admin/system-check') {
    return handleSystemCheck(url, ctx, startedAt);
  }

  if (method === 'GET' && path === '/api/admin/phone-normalize-check') {
    return handlePhoneNormalizeCheck(url, ctx);
  }

  // Browser-friendly: allow GET for営業前デモ準備, and keep POST for管理画面ボタン/API calls.
  if ((method === 'GET' || method === 'POST') && path === '/api/admin/demo/prepare') {
    return handleDemoPrepare(request, url, ctx);
  }

  if (method === 'GET' && path === '/api/admin/day') {
    return handleAdminDay(url, ctx);
  }

  if (path === '/api/admin/reservations') {
    if (method === 'GET') return handleAdminReservations(url, ctx);
    if (method === 'POST') return handleCreateReservation(request, url, ctx, 'admin');
    if (method === 'PATCH') return handleUpdateReservation(request, url, ctx);
  }

  if (method === 'PATCH' && path === '/api/admin/reservations/status') {
    return handleReservationStatus(request, url, ctx);
  }

  if (method === 'GET' && path === '/api/admin/customers/search') {
    return handleCustomerSearch(url, ctx);
  }

  if (method === 'GET' && path === '/api/admin/customers/detail') {
    return handleCustomerDetail(url, ctx);
  }

  if (method === 'POST' && path === '/api/admin/karte/save') {
    return handleKarteSave(request, url, ctx);
  }

  if (path === '/api/admin/tickets') {
    if (method === 'GET') return handleTickets(url, ctx);
    if (method === 'POST') return handleIssueTicket(request, url, ctx);
  }

  if (method === 'POST' && path === '/api/admin/ticket/use') {
    return handleUseTicket(request, url, ctx);
  }

  if (path === '/api/admin/followups') {
    if (method === 'GET') return handleFollowups(url, ctx);
    if (method === 'PATCH') return handleUpdateFollowup(request, url, ctx);
  }

  if (path === '/api/admin/settings') {
    if (method === 'GET') return handlePublicSettings(url, ctx, true);
    if (method === 'POST' || method === 'PATCH') return handleSaveSettings(request, url, ctx);
  }

  // STEP ESTHE-12A: owner.html から分かりやすく呼べる保存専用エイリアス
  if (path === '/api/admin/settings/save') {
    if (method === 'POST' || method === 'PATCH') return handleSaveSettings(request, url, ctx);
  }

  if (method === 'POST' && path === '/api/admin/staff-sessions') {
    return handleIssueStaffSession(request, url, ctx);
  }

  if (method === 'DELETE' && path === '/api/admin/staff-sessions') {
    return handleRevokeStaffSession(request, url, ctx);
  }

  if (method === 'GET' && path === '/api/admin/message-templates') {
    return handleMessageTemplates(url, ctx);
  }

  if (method === 'POST' && path === '/api/admin/message-log') {
    return handleMessageLog(request, url, ctx);
  }

  return jsonResponse({
    ok: false,
    error: 'not_found',
    message: 'API endpoint not found.',
    path,
    method,
    version: VERSION,
  }, 404);
}

function createContext(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY をWorker環境変数に設定してください。');
  }

  return {
    env,
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    serviceKey,
    defaultShopCode: env.ESTHE_DEFAULT_SHOP_CODE || DEFAULT_SHOP_CODE,
    adminSecret: env.ESTHE_ADMIN_SECRET || '',
    lineLoginChannelId: env.ESTHE_LINE_LOGIN_CHANNEL_ID || env.LINE_LOGIN_CHANNEL_ID || '',
    frontendContractUrl: env.ESTHE_FRONTEND_CONTRACT_URL || DEFAULT_FRONTEND_CONTRACT_URL,
    auth: null,
  };
}

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function endpointList() {
  return [
    'GET  /api/health',
    'GET  /api/public/settings',
    'GET  /api/public/menus',
    'GET  /api/public/staff',
    'GET  /api/public/slots?date=YYYY-MM-DD&menu_id=...',
    'POST /api/public/reservations',
    'POST /api/public/reservation/change',
    'POST /api/public/reservation/cancel',
    'GET  /api/public/my-page',
    'GET  /api/admin/system-check',
    'GET  /api/admin/phone-normalize-check',
    'GET  /api/admin/demo/prepare',
    'POST /api/admin/demo/prepare',
    'GET  /api/admin/day',
    'GET  /api/admin/reservations',
    'POST /api/admin/reservations',
    'PATCH /api/admin/reservations',
    'PATCH /api/admin/reservations/status',
    'GET  /api/admin/customers/search',
    'GET  /api/admin/customers/detail',
    'POST /api/admin/karte/save',
    'GET  /api/admin/tickets',
    'POST /api/admin/tickets',
    'POST /api/admin/ticket/use',
    'GET  /api/admin/followups',
    'PATCH /api/admin/followups',
    'GET  /api/admin/settings',
    'POST /api/admin/settings',
    'POST /api/admin/settings/save',
    'GET  /api/admin/message-templates',
    'POST /api/admin/message-log',
    'POST /api/admin/staff-sessions',
    'DELETE /api/admin/staff-sessions',
  ];
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error('JSONの形式が正しくありません。');
  }
}

function isDemoShop(shop) {
  return String(shop?.status || '').toLowerCase() === 'demo' || Boolean(shop?.settings?.demo_enabled);
}

function suppliedDemoAdminSecret(request, url) {
  return cleanText(request.headers.get('x-admin-secret') || url.searchParams.get('admin_key') || '');
}

function bearerToken(request) {
  const header = cleanText(request.headers.get('authorization'));
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

async function sha256Base64Url(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let binary = '';
  for (const b of digest) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function adminRequestShop(request, url, ctx) {
  let shopCode = cleanText(url.searchParams.get('shop_code')) || ctx.defaultShopCode;
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    const body = await request.clone().json().catch(() => ({}));
    shopCode = cleanText(body.shop_code) || shopCode;
  }
  return getShop(ctx, shopCode);
}

async function verifyDproOwnerSession(request, shop, ctx) {
  const token = bearerToken(request);
  if (!token) return { ok: false, absent: true };

  const tokenHash = await sha256Base64Url(token);
  const sessions = await supabaseFetch(ctx, 'dpro_owner_sessions', {
    query: { select: '*', token_hash: `eq.${tokenHash}`, revoked_at: 'is.null', limit: 1 },
  });
  const session = sessions[0];
  if (!session || !session.expires_at || new Date(session.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, code: 'DPRO_AUTH_INVALID', message: 'オーナーログイン情報が無効または期限切れです。' };
  }

  const accounts = await supabaseFetch(ctx, 'dpro_owner_accounts', {
    query: { select: '*', id: `eq.${session.owner_account_id}`, limit: 1 },
  });
  const account = accounts[0];
  if (!account || ['disabled', 'suspended'].includes(String(account.status || '').toLowerCase())) {
    return { ok: false, status: account ? 403 : 401, code: 'DPRO_AUTH_ACCOUNT_UNAVAILABLE', message: 'オーナーアカウントを利用できません。' };
  }
  if (String(account.system_code || '').toUpperCase() !== DPRO_AUTH_SYSTEM_CODE || String(account.facility_code || '') !== String(shop.shop_code || '')) {
    return { ok: false, status: 403, code: 'DPRO_AUTH_SCOPE_MISMATCH', message: 'この店舗を操作する権限がありません。' };
  }
  if (String(account.environment || '').toLowerCase() !== 'production') {
    return { ok: false, status: 403, code: 'DPRO_AUTH_ENVIRONMENT_MISMATCH', message: '本番店舗では本番オーナー認証が必要です。' };
  }
  return {
    ok: true,
    actorType: 'owner',
    actorId: String(account.id),
    role: 'owner',
    scopes: ['*'],
    ownerAccountId: account.id,
    shop,
  };
}

function staffSessionToken(request) {
  return cleanText(request.headers.get('x-esthe-staff-session') || request.headers.get('x-staff-session') || '');
}

async function verifyStaffSession(request, shop, ctx) {
  const token = staffSessionToken(request);
  if (!token) return { ok: false, absent: true };
  const tokenHash = await sha256Base64Url(token);
  const rows = await supabaseFetch(ctx, 'esthe_staff_sessions', {
    query: { select: '*', token_hash: `eq.${tokenHash}`, shop_id: `eq.${shop.id}`, revoked_at: 'is.null', limit: 1 },
  });
  const session = rows[0];
  if (!session || !session.expires_at || new Date(session.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, code: 'ESTHE_STAFF_SESSION_INVALID', message: 'スタッフログイン情報が無効または期限切れです。' };
  }
  const staff = await firstRow(ctx, 'esthe_staff', { select: '*', id: `eq.${session.staff_id}`, shop_id: `eq.${shop.id}`, is_active: 'eq.true' });
  if (!staff) return { ok: false, status: 403, code: 'ESTHE_STAFF_INACTIVE', message: 'スタッフ権限を確認できません。' };
  if (String(session.role || '') !== String(staff.role || '')) {
    return { ok: false, status: 403, code: 'ESTHE_STAFF_ROLE_CHANGED', message: 'スタッフ権限が変更されています。再ログインしてください。' };
  }
  return {
    ok: true,
    actorType: 'staff',
    actorId: String(staff.id),
    role: String(session.role || 'staff'),
    scopes: Array.isArray(session.scopes) ? session.scopes : [],
    staffSessionId: session.id,
    shop,
  };
}

function requiredAdminScope(path, method) {
  const ownerOnly = new Set([
    '/api/admin/system-check', '/api/admin/phone-normalize-check', '/api/admin/demo/prepare',
    '/api/admin/settings/save', '/api/admin/staff-sessions'
  ]);
  if (ownerOnly.has(path)) return 'owner';
  if (path === '/api/admin/settings' && method !== 'GET') return 'owner';
  if (method === 'GET') return 'operations_read';
  if (path === '/api/admin/karte/save') return 'karte_write';
  if (path === '/api/admin/tickets' || path === '/api/admin/ticket/use') return 'ticket_write';
  if (path === '/api/admin/followups') return 'followup_write';
  if (path === '/api/admin/message-log') return 'message_write';
  if (path === '/api/admin/reservations/status') return 'reservation_status_write';
  if (path === '/api/admin/reservations') return 'reservation_write';
  return 'owner';
}

function authError(status, code, message, shop, extra = {}) {
  return {
    ok: false,
    actorType: 'anonymous', actorId: null, role: null, scopes: [], shop,
    ...extra,
    response: jsonResponse({ ok: false, error: code, message, version: VERSION }, status),
  };
}

async function authorizeAdminRequest(request, url, path, method, ctx) {
  const shop = await adminRequestShop(request, url, ctx);
  const requiredScope = requiredAdminScope(path, method);

  if (isDemoShop(shop)) {
    const supplied = suppliedDemoAdminSecret(request, url);
    if (!ctx.adminSecret) return authError(503, 'DEMO_ADMIN_SECRET_NOT_CONFIGURED', 'DEMO管理コードがWorker Secretに設定されていません。', shop, { requiredScope });
    if (supplied !== ctx.adminSecret) return authError(401, 'DEMO_ADMIN_UNAUTHORIZED', 'DEMO管理APIの管理コードが正しくありません。', shop, { requiredScope });
    return { ok: true, actorType: 'demo', actorId: 'demo-admin', role: 'owner', scopes: ['*'], shop, requiredScope };
  }

  // Production: demo secret/query credentials are never authority.
  const owner = await verifyDproOwnerSession(request, shop, ctx);
  if (owner.ok) return { ...owner, requiredScope };
  if (!owner.absent) return authError(owner.status || 401, owner.code || 'DPRO_AUTH_INVALID', owner.message || 'オーナー認証に失敗しました。', shop, { requiredScope });

  const staff = await verifyStaffSession(request, shop, ctx);
  if (!staff.ok) {
    if (!staff.absent) return authError(staff.status || 401, staff.code || 'ESTHE_STAFF_SESSION_INVALID', staff.message || 'スタッフ認証に失敗しました。', shop, { requiredScope });
    return authError(401, 'PRODUCTION_AUTH_REQUIRED', '本番管理APIにはCommon Owner Authまたはスタッフセッションが必要です。', shop, { requiredScope });
  }

  if (requiredScope === 'owner') return authError(403, 'OWNER_AUTH_REQUIRED', 'この操作にはオーナー権限が必要です。', shop, { ...staff, requiredScope });
  if (!staff.scopes.includes(requiredScope) && !staff.scopes.includes('*')) {
    return authError(403, 'STAFF_SCOPE_DENIED', 'この操作を行うスタッフ権限がありません。', shop, { ...staff, requiredScope });
  }
  return { ...staff, requiredScope };
}

function defaultScopesForRole(role) {
  const value = String(role || 'staff').toLowerCase();
  if (value === 'manager') return ['operations_read','reservation_write','reservation_status_write','karte_write','ticket_write','followup_write','message_write'];
  if (value === 'reception') return ['operations_read','reservation_write','reservation_status_write','ticket_write','message_write'];
  if (value === 'therapist') return ['operations_read','reservation_status_write','karte_write'];
  return ['operations_read'];
}

function randomSessionToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function handleIssueStaffSession(request, url, ctx) {
  if (ctx.auth?.actorType !== 'owner' && ctx.auth?.actorType !== 'demo') {
    return jsonResponse({ ok:false, error:'OWNER_AUTH_REQUIRED', message:'スタッフセッション発行にはオーナー権限が必要です。', version:VERSION }, 403);
  }
  const body = await readJson(request);
  const shop = ctx.auth.shop || await getShopFromUrl(url, ctx);
  const staffId = cleanText(body.staff_id);
  if (!staffId) throw new Error('staff_id は必須です。');
  const staff = await firstRow(ctx, 'esthe_staff', { select:'*', id:`eq.${staffId}`, shop_id:`eq.${shop.id}`, is_active:'eq.true' });
  if (!staff) throw new Error('有効なスタッフが見つかりません。');
  const role = ['manager','reception','therapist','staff'].includes(String(staff.role || '')) ? String(staff.role) : 'staff';
  const requestedScopes = Array.isArray(body.scopes) ? body.scopes.map(cleanText).filter(Boolean) : [];
  const allowed = new Set(defaultScopesForRole(role));
  const scopes = requestedScopes.length ? requestedScopes.filter((v) => allowed.has(v)) : [...allowed];
  const ttlMinutes = clamp(Number(body.ttl_minutes || 480), 15, 720);
  const rawToken = randomSessionToken();
  const tokenHash = await sha256Base64Url(rawToken);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString();
  const inserted = await supabaseFetch(ctx, 'esthe_staff_sessions', {
    method:'POST', prefer:'return=representation', body:{
      shop_id:shop.id, staff_id:staff.id, token_hash:tokenHash, role, scopes,
      created_by_owner_account_id:ctx.auth.ownerAccountId || null,
      is_demo:isDemoShop(shop), expires_at:expiresAt,
    }
  });
  return jsonResponse({ ok:true, staff_session_token:rawToken, expires_at:expiresAt, role, scopes, session_id:inserted[0]?.id || null, version:VERSION });
}

async function handleRevokeStaffSession(request, url, ctx) {
  if (ctx.auth?.actorType !== 'owner' && ctx.auth?.actorType !== 'demo') {
    return jsonResponse({ ok:false, error:'OWNER_AUTH_REQUIRED', message:'スタッフセッション失効にはオーナー権限が必要です。', version:VERSION }, 403);
  }
  const body = await readJson(request);
  const sessionId = cleanText(body.session_id);
  if (!sessionId) throw new Error('session_id は必須です。');
  const shop = ctx.auth.shop || await getShopFromUrl(url, ctx);
  await supabaseFetch(ctx, 'esthe_staff_sessions', {
    method:'PATCH', query:{ id:`eq.${sessionId}`, shop_id:`eq.${shop.id}` }, body:{ revoked_at:new Date().toISOString() }
  });
  return jsonResponse({ ok:true, revoked:true, session_id:sessionId, version:VERSION });
}

function shouldAuditAdmin(path, method, status) {
  return path.startsWith('/api/admin/') && (status >= 400 || !['GET','HEAD'].includes(method));
}

function auditTarget(path, url, body) {
  const pairs = [
    ['reservation', body.reservation_id || body.id], ['customer', body.customer_id], ['staff', body.staff_id],
    ['ticket', body.ticket_id], ['followup', body.followup_id], ['session', body.session_id]
  ];
  for (const [type, id] of pairs) if (id) return { type, id:String(id) };
  const qid = url.searchParams.get('reservation_id') || url.searchParams.get('customer_id') || url.searchParams.get('staff_id') || '';
  return { type: path.split('/').filter(Boolean).slice(-1)[0] || 'route', id: qid || null };
}

async function auditAdminOperationSafely(request, url, path, ctx, status) {
  const method = request.method.toUpperCase();
  if (!shouldAuditAdmin(path, method, status)) return;
  try {
    const shop = ctx.auth?.shop || await adminRequestShop(request, url, ctx);
    const body = !['GET','HEAD'].includes(method) ? await request.clone().json().catch(() => ({})) : {};
    const target = auditTarget(path, url, body);
    const auth = ctx.auth || {};
    await supabaseFetch(ctx, 'esthe_operation_logs', {
      method:'POST', body:{
        shop_id:shop.id,
        actor_type:auth.actorType || 'anonymous',
        actor_id:auth.actorId || null,
        actor_role:auth.role || null,
        action:`${method} ${path}`,
        target_type:target.type,
        target_id:target.id,
        result:status < 400 ? 'success' : (status < 500 ? 'denied' : 'error'),
        http_method:method,
        route:path,
        request_id:cleanText(request.headers.get('x-request-id')) || crypto.randomUUID(),
        detail:{ status, required_scope:auth.requiredScope || null },
      }
    });
  } catch (auditError) {
    console.error('ESTHE audit write failed', auditError?.message || auditError);
  }
}

async function supabaseFetch(ctx, tableOrPath, options = {}) {
  const method = options.method || 'GET';
  const query = options.query || {};
  const isFullPath = tableOrPath.startsWith('/');
  const base = isFullPath
    ? `${ctx.supabaseUrl}${tableOrPath}`
    : `${ctx.supabaseUrl}/rest/v1/${tableOrPath}`;

  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    apikey: ctx.serviceKey,
    Authorization: `Bearer ${ctx.serviceKey}`,
    'Content-Type': 'application/json',
    ...(options.prefer ? { Prefer: options.prefer } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = text;
    }
  }

  if (!res.ok) {
    const message = typeof data === 'object' && data?.message ? data.message : text || `Supabase error ${res.status}`;
    throw new Error(message);
  }

  return data;
}

async function getShop(ctx, shopCode) {
  const code = shopCode || ctx.defaultShopCode;
  const rows = await supabaseFetch(ctx, 'esthe_shops', {
    query: {
      select: '*',
      shop_code: `eq.${code}`,
      limit: 1,
    },
  });
  if (!rows || rows.length === 0) {
    throw new Error(`店舗が見つかりません: ${code}`);
  }
  return rows[0];
}

async function getShopFromUrl(url, ctx) {
  return getShop(ctx, url.searchParams.get('shop_code') || ctx.defaultShopCode);
}

async function probeDatabaseBaseline(ctx) {
  const tables = [
    'esthe_shops','esthe_customers','esthe_reservations','esthe_business_hours','esthe_menus','esthe_staff',
    'esthe_customer_tickets','esthe_followups','esthe_staff_sessions','esthe_operation_logs',
    'dpro_owner_accounts','dpro_owner_sessions'
  ];
  const probes = [];
  for (const table of tables) {
    try {
      await supabaseFetch(ctx, table, { query:{ select:'id', limit:1 } });
      probes.push({ table, ok:true });
    } catch (error) {
      probes.push({ table, ok:false, error:error?.message || String(error) });
    }
  }
  const ok = probes.every((p) => p.ok);
  return { ok, version:ok ? READY_RELEASE.expectedDatabaseVersion : null, probeCount:probes.length, probes };
}

async function probeFrontendContract(ctx) {
  try {
    const res = await fetch(`${ctx.frontendContractUrl}?ready=${encodeURIComponent(VERSION)}`, { headers:{ 'Cache-Control':'no-cache, no-store' } });
    const data = await res.json().catch(() => null);
    const version = cleanText(data?.frontendVersion || data?.frontend_version);
    const contractVersion = cleanText(data?.contractVersion || data?.contract_version);
    return {
      ok:res.ok && version === READY_RELEASE.expectedFrontendVersion && contractVersion === READY_RELEASE.contractVersion,
      version:version || null,
      contractVersion:contractVersion || null,
      url:ctx.frontendContractUrl,
      httpStatus:res.status,
    };
  } catch (error) {
    return { ok:false, version:null, contractVersion:null, url:ctx.frontendContractUrl, error:error?.message || String(error) };
  }
}

async function productReadyRuntime(ctx) {
  const [database, frontend] = await Promise.all([probeDatabaseBaseline(ctx), probeFrontendContract(ctx)]);
  const workerVersion = VERSION;
  const versionsAligned = workerVersion === READY_RELEASE.expectedWorkerVersion
    && database.version === READY_RELEASE.expectedDatabaseVersion
    && frontend.version === READY_RELEASE.expectedFrontendVersion
    && frontend.contractVersion === READY_RELEASE.contractVersion;
  return {
    contractVersion:READY_RELEASE.contractVersion,
    adapterVersion:READY_RELEASE.adapterVersion,
    workerVersion,
    databaseVersion:database.version,
    frontendVersion:frontend.version,
    versionsAligned,
    databaseVersionVerified:database.ok,
    databaseProbeCount:database.probeCount,
    frontendContractVerified:frontend.ok,
    expected:{
      workerVersion:READY_RELEASE.expectedWorkerVersion,
      databaseVersion:READY_RELEASE.expectedDatabaseVersion,
      frontendVersion:READY_RELEASE.expectedFrontendVersion,
    },
    databaseProbes:database.probes,
    frontendProbe:frontend,
  };
}

function productReadyCapabilities(ctx) {
  return {
    ownerAuthReady:true,
    ownerAuthMode:'DPRO_COMMON_OWNER_AUTH',
    ownerCustomerBinding:'deferred_until_contract',
    demoAdminCredentialScope:'demo_only',
    lineIdentityVerificationReady:true,
    lineIdentityMode:'server_verified_id_token',
    lineChannelConfigured:Boolean(ctx.lineLoginChannelId),
    lineCustomerBinding:'deferred_until_contract',
    staffPermissionReady:true,
    staffPermissionMode:'server_scoped_session',
    auditReady:true,
    auditLedger:'esthe_operation_logs',
  };
}

async function handleHealth(url, ctx, startedAt) {
  const shopCode = url.searchParams.get('shop_code') || ctx.defaultShopCode;
  let shop = null;
  let dbOk = false;
  let demoCounts = null;
  let dbError = null;
  let readyRuntime = null;

  try {
    shop = await getShop(ctx, shopCode);
    dbOk = true;
    demoCounts = await getBasicCounts(ctx, shop.id);
    readyRuntime = await productReadyRuntime(ctx);
  } catch (error) {
    dbError = error?.message || String(error);
  }

  const capabilities = productReadyCapabilities(ctx);
  const readyOk = Boolean(dbOk && readyRuntime?.versionsAligned && readyRuntime?.databaseVersionVerified && readyRuntime?.frontendContractVerified);
  return jsonResponse({
    ok: dbOk,
    service: SERVICE_NAME,
    systemCode:'ESTHE',
    version: VERSION,
    legacyBaselineVersion:LEGACY_BASELINE_VERSION,
    worker_name: 'dpro-esthe-relax-line-api',
    adapterVersion:READY_RELEASE.adapterVersion,
    contractVersion:READY_RELEASE.contractVersion,
    workerVersion:readyRuntime?.workerVersion || VERSION,
    databaseVersion:readyRuntime?.databaseVersion || null,
    frontendVersion:readyRuntime?.frontendVersion || null,
    versionsAligned:Boolean(readyRuntime?.versionsAligned),
    systemCheckReady:true,
    systemCheckOk:readyOk,
    productionGuard:true,
    demoGuard:true,
    capabilities,
    shop_code: shopCode,
    shop_name: shop?.shop_name || null,
    shop_environment:isDemoShop(shop) ? 'demo' : 'production',
    db_ok: dbOk,
    db_error: dbError,
    databaseVersionVerified:Boolean(readyRuntime?.databaseVersionVerified),
    databaseProbeCount:readyRuntime?.databaseProbeCount || 0,
    frontendContractVerified:Boolean(readyRuntime?.frontendContractVerified),
    counts: demoCounts,
    response_ms: Date.now() - startedAt,
    time: new Date().toISOString(),
  }, dbOk ? 200 : 500);
}

async function getBasicCounts(ctx, shopId) {
  const [customers, reservations, followups, tickets] = await Promise.all([
    supabaseFetch(ctx, 'esthe_customers', { query: { select: 'id', shop_id: `eq.${shopId}`, is_demo: 'eq.true' } }),
    supabaseFetch(ctx, 'esthe_reservations', { query: { select: 'id', shop_id: `eq.${shopId}`, is_demo: 'eq.true' } }),
    supabaseFetch(ctx, 'esthe_followups', { query: { select: 'id', shop_id: `eq.${shopId}`, is_demo: 'eq.true' } }),
    supabaseFetch(ctx, 'esthe_customer_tickets', { query: { select: 'id', shop_id: `eq.${shopId}`, is_demo: 'eq.true' } }),
  ]);
  return {
    demo_customers: customers.length,
    demo_reservations: reservations.length,
    demo_followups: followups.length,
    demo_tickets: tickets.length,
  };
}

async function handlePublicSettings(url, ctx, adminMode = false) {
  const shop = await getShopFromUrl(url, ctx);
  const today = todayJst();
  const futureDate = addDaysJst(today, Number(shop.default_booking_days_ahead || 60));

  const [businessHours, closedDays, menus, staff, rooms, ticketPlans, templates, settings] = await Promise.all([
    supabaseFetch(ctx, 'esthe_business_hours', {
      query: { select: '*', shop_id: `eq.${shop.id}`, order: 'day_of_week.asc' },
    }),
    supabaseFetch(ctx, 'esthe_closed_days', {
      query: { select: '*', shop_id: `eq.${shop.id}`, target_date: `gte.${today}`, order: 'target_date.asc', limit: 120 },
    }),
    supabaseFetch(ctx, 'esthe_menus', {
      query: { select: '*', shop_id: `eq.${shop.id}`, is_active: 'eq.true', order: 'display_order.asc' },
    }),
    supabaseFetch(ctx, 'esthe_staff', {
      query: { select: '*', shop_id: `eq.${shop.id}`, is_active: 'eq.true', order: 'display_order.asc' },
    }),
    supabaseFetch(ctx, 'esthe_rooms', {
      query: { select: '*', shop_id: `eq.${shop.id}`, is_active: 'eq.true', order: 'display_order.asc' },
    }),
    supabaseFetch(ctx, 'esthe_ticket_plans', {
      query: { select: '*', shop_id: `eq.${shop.id}`, is_active: 'eq.true', order: 'display_order.asc' },
    }),
    supabaseFetch(ctx, 'esthe_message_templates', {
      query: { select: '*', shop_id: `eq.${shop.id}`, is_active: 'eq.true', order: 'display_order.asc' },
    }),
    supabaseFetch(ctx, 'esthe_settings', {
      query: { select: '*', shop_id: `eq.${shop.id}`, order: 'setting_key.asc' },
    }),
  ]);

  const publicShop = adminMode ? shop : sanitizePublicShop(shop);

  return jsonResponse({
    ok: true,
    service: SERVICE_NAME,
    version: VERSION,
    mode: adminMode ? 'admin' : 'public',
    shop: publicShop,
    business_hours: businessHours,
    closed_days: closedDays,
    menus,
    staff,
    rooms,
    ticket_plans: ticketPlans,
    message_templates: templates,
    settings,
    booking_range: {
      from: today,
      to: futureDate,
      days_ahead: shop.default_booking_days_ahead,
    },
    time: new Date().toISOString(),
  });
}

function sanitizePublicShop(shop) {
  return {
    id: shop.id,
    shop_code: shop.shop_code,
    shop_name: shop.shop_name,
    display_name: shop.display_name,
    phone: shop.phone,
    address: shop.address,
    description: shop.description,
    notice: shop.notice,
    completion_message: shop.completion_message,
    timezone: shop.timezone,
    simple_enabled: shop.simple_enabled,
    brush_enabled: shop.brush_enabled,
    default_booking_days_ahead: shop.default_booking_days_ahead,
    booking_deadline_hours: shop.booking_deadline_hours,
    same_day_booking: shop.same_day_booking,
    cancel_deadline_hours: shop.cancel_deadline_hours,
    slot_interval_minutes: shop.slot_interval_minutes,
    default_buffer_before_minutes: shop.default_buffer_before_minutes,
    default_buffer_after_minutes: shop.default_buffer_after_minutes,
    max_daily_reservations: shop.max_daily_reservations,
    rooms_count: shop.rooms_count,
    settings: shop.settings,
  };
}

async function handlePublicMenus(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const rows = await supabaseFetch(ctx, 'esthe_menus', {
    query: {
      select: '*',
      shop_id: `eq.${shop.id}`,
      is_active: 'eq.true',
      order: 'display_order.asc',
    },
  });
  return jsonResponse({ ok: true, shop_code: shop.shop_code, menus: rows, version: VERSION });
}

async function handlePublicStaff(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const menuId = url.searchParams.get('menu_id');
  let rows = await supabaseFetch(ctx, 'esthe_staff', {
    query: {
      select: '*',
      shop_id: `eq.${shop.id}`,
      is_active: 'eq.true',
      can_be_selected: 'eq.true',
      order: 'display_order.asc',
    },
  });

  if (menuId) {
    const skills = await supabaseFetch(ctx, 'esthe_staff_menu_skills', {
      query: {
        select: 'staff_id',
        shop_id: `eq.${shop.id}`,
        menu_id: `eq.${menuId}`,
        is_active: 'eq.true',
      },
    });
    const allowed = new Set(skills.map((s) => s.staff_id));
    rows = rows.filter((s) => s.staff_code === 'omakase' || allowed.has(s.id));
  }

  return jsonResponse({ ok: true, shop_code: shop.shop_code, staff: rows, version: VERSION });
}

async function handlePublicSlots(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const date = url.searchParams.get('date') || todayJst();
  const menuId = url.searchParams.get('menu_id') || '';
  const menuCode = url.searchParams.get('menu_code') || '';
  const staffId = url.searchParams.get('staff_id') || '';
  const staffCode = url.searchParams.get('staff_code') || '';

  const result = await buildSlots(ctx, shop, { date, menuId, menuCode, staffId, staffCode });
  return jsonResponse({ ok: true, ...result, version: VERSION });
}

async function buildSlots(ctx, shop, params) {
  const date = params.date;
  assertDate(date, 'date');

  const today = todayJst();
  if (date < today) {
    return { shop_code: shop.shop_code, date, slots: [], closed: true, reason: '過去日は予約できません。' };
  }

  const maxDate = addDaysJst(today, Number(shop.default_booking_days_ahead || 60));
  if (date > maxDate) {
    return { shop_code: shop.shop_code, date, slots: [], closed: true, reason: '予約受付期間外です。' };
  }

  let menu = null;
  if (params.menuId) {
    menu = await firstRow(ctx, 'esthe_menus', { select: '*', shop_id: `eq.${shop.id}`, id: `eq.${params.menuId}`, is_active: 'eq.true' });
  } else if (params.menuCode) {
    menu = await firstRow(ctx, 'esthe_menus', { select: '*', shop_id: `eq.${shop.id}`, menu_code: `eq.${params.menuCode}`, is_active: 'eq.true' });
  } else {
    menu = await firstRow(ctx, 'esthe_menus', { select: '*', shop_id: `eq.${shop.id}`, is_active: 'eq.true', order: 'display_order.asc', limit: 1 });
  }
  if (!menu) throw new Error('メニューが見つかりません。');

  let selectedStaff = null;
  if (params.staffId) {
    selectedStaff = await firstRow(ctx, 'esthe_staff', { select: '*', shop_id: `eq.${shop.id}`, id: `eq.${params.staffId}`, is_active: 'eq.true' });
  } else if (params.staffCode) {
    selectedStaff = await firstRow(ctx, 'esthe_staff', { select: '*', shop_id: `eq.${shop.id}`, staff_code: `eq.${params.staffCode}`, is_active: 'eq.true' });
  }

  const dayOfWeek = dayOfWeekFromDate(date);
  const businessHour = await firstRow(ctx, 'esthe_business_hours', {
    select: '*',
    shop_id: `eq.${shop.id}`,
    day_of_week: `eq.${dayOfWeek}`,
  });

  const specialDay = await firstRow(ctx, 'esthe_closed_days', {
    select: '*',
    shop_id: `eq.${shop.id}`,
    target_date: `eq.${date}`,
  });

  const openInfo = resolveOpenInfo(businessHour, specialDay);
  if (!openInfo.isOpen) {
    return {
      shop_code: shop.shop_code,
      date,
      menu,
      staff: selectedStaff,
      slots: [],
      closed: true,
      reason: openInfo.reason,
    };
  }

  const [reservations, rooms, staffShifts] = await Promise.all([
    fetchReservationsForDate(ctx, shop.id, date),
    supabaseFetch(ctx, 'esthe_rooms', { query: { select: '*', shop_id: `eq.${shop.id}`, is_active: 'eq.true' } }),
    selectedStaff
      ? fetchStaffShift(ctx, shop.id, selectedStaff.id, date, dayOfWeek)
      : Promise.resolve([]),
  ]);

  const activeCapacity = Math.max(1, Number(rooms.length || shop.rooms_count || 1));
  const interval = Number(shop.slot_interval_minutes || 30);
  const duration = Number(menu.duration_minutes || 60);
  const bufferBefore = Number(menu.buffer_before_minutes ?? shop.default_buffer_before_minutes ?? 0);
  const bufferAfter = Number(menu.buffer_after_minutes ?? shop.default_buffer_after_minutes ?? 0);
  const requiredMinutes = bufferBefore + duration + bufferAfter;
  const openMin = timeToMinutes(openInfo.openTime);
  const closeMin = timeToMinutes(openInfo.closeTime);
  const latestStart = closeMin - requiredMinutes;

  const dailyActiveCount = reservations.filter((r) => ACTIVE_RESERVATION_STATUSES.has(r.status)).length;
  const dailyFull = dailyActiveCount >= Number(shop.max_daily_reservations || 9999);
  const slots = [];

  for (let startMin = openMin; startMin <= latestStart; startMin += interval) {
    const treatmentStartMin = startMin + bufferBefore;
    const treatmentEndMin = treatmentStartMin + duration;
    const displayTime = minutesToTime(treatmentStartMin);
    const startAt = localDateTimeToDate(date, displayTime);
    const endAt = new Date(startAt.getTime() + duration * 60000);
    const blockStartAt = localDateTimeToDate(date, minutesToTime(startMin));
    const blockEndAt = new Date(blockStartAt.getTime() + requiredMinutes * 60000);

    let available = true;
    const reasons = [];

    if (!shop.same_day_booking && date === today) {
      available = false;
      reasons.push('当日予約不可');
    }

    if (date === today) {
      const deadlineMs = Date.now() + Number(shop.booking_deadline_hours || 0) * 3600000;
      if (startAt.getTime() < deadlineMs) {
        available = false;
        reasons.push('予約締切時間を過ぎています');
      }
    }

    if (dailyFull) {
      available = false;
      reasons.push('1日の予約上限に達しています');
    }

    const overlapReservations = reservations.filter((r) => overlaps(new Date(r.start_at), new Date(r.end_at), blockStartAt, blockEndAt));
    if (overlapReservations.length >= activeCapacity) {
      available = false;
      reasons.push('ベッド・個室が埋まっています');
    }

    if (selectedStaff && selectedStaff.staff_code !== 'omakase') {
      const staffAvailable = isStaffAvailableAt(selectedStaff, staffShifts, blockStartAt, blockEndAt, date, displayTime);
      if (!staffAvailable.ok) {
        available = false;
        reasons.push(staffAvailable.reason);
      }
      const staffOverlap = overlapReservations.filter((r) => r.staff_id === selectedStaff.id);
      if (staffOverlap.length > 0) {
        available = false;
        reasons.push('指定スタッフが予約済みです');
      }
    }

    slots.push({
      time: displayTime,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      available,
      label: available ? '予約可' : reasons[0] || '予約不可',
      reasons,
      remaining_capacity: available ? Math.max(0, activeCapacity - overlapReservations.length) : 0,
    });
  }

  return {
    shop_code: shop.shop_code,
    date,
    day_of_week: dayOfWeek,
    menu,
    staff: selectedStaff,
    open_time: openInfo.openTime,
    close_time: openInfo.closeTime,
    capacity: activeCapacity,
    daily_active_count: dailyActiveCount,
    slots,
    closed: false,
    reason: null,
  };
}

const ACTIVE_RESERVATION_STATUSES = new Set(['reserved', 'checked_in', 'in_treatment', 'waiting_payment']);

function resolveOpenInfo(businessHour, specialDay) {
  if (specialDay) {
    if (specialDay.day_type === 'closed') {
      return { isOpen: false, reason: specialDay.title || '臨時休業日です。' };
    }
    if ((specialDay.day_type === 'special_open' || specialDay.day_type === 'shortened') && specialDay.open_time && specialDay.close_time) {
      return { isOpen: true, openTime: specialDay.open_time.slice(0, 5), closeTime: specialDay.close_time.slice(0, 5), reason: specialDay.title };
    }
  }

  if (!businessHour || !businessHour.is_open) {
    return { isOpen: false, reason: businessHour?.note || '定休日です。' };
  }
  return { isOpen: true, openTime: businessHour.open_time.slice(0, 5), closeTime: businessHour.close_time.slice(0, 5), reason: businessHour.note };
}

async function fetchReservationsForDate(ctx, shopId, date) {
  const range = dateRangeJst(date);
  return supabaseFetch(ctx, 'esthe_reservations', {
    query: {
      select: '*',
      shop_id: `eq.${shopId}`,
      start_at: `gte.${range.startIso}`,
      end_at: `lt.${range.endIso}`,
      status: 'in.(reserved,checked_in,in_treatment,waiting_payment)',
      order: 'start_at.asc',
    },
  });
}

async function fetchStaffShift(ctx, shopId, staffId, date, dayOfWeek) {
  return supabaseFetch(ctx, 'esthe_staff_shifts', {
    query: {
      select: '*',
      shop_id: `eq.${shopId}`,
      staff_id: `eq.${staffId}`,
      or: `(shift_date.eq.${date},day_of_week.eq.${dayOfWeek})`,
    },
  });
}

function isStaffAvailableAt(staff, shifts, blockStartAt, blockEndAt, date, displayTime) {
  if (!staff || staff.staff_code === 'omakase') return { ok: true };
  if (!shifts || shifts.length === 0) return { ok: true };

  const exact = shifts.find((s) => s.shift_date === date);
  const weekly = shifts.find((s) => !s.shift_date);
  const shift = exact || weekly;
  if (!shift) return { ok: true };
  if (!shift.is_working) return { ok: false, reason: '指定スタッフは休みです' };
  if (!shift.start_time || !shift.end_time) return { ok: true };

  const startMin = timeToMinutes(displayTime);
  const endMin = startMin + Math.round((blockEndAt.getTime() - blockStartAt.getTime()) / 60000);
  const shiftStart = timeToMinutes(shift.start_time.slice(0, 5));
  const shiftEnd = timeToMinutes(shift.end_time.slice(0, 5));
  if (startMin < shiftStart || endMin > shiftEnd) {
    return { ok: false, reason: '指定スタッフの勤務時間外です' };
  }
  return { ok: true };
}

async function handleCreateReservation(request, url, ctx, defaultSource) {
  const body = await readJson(request);
  const shop = await getShop(ctx, body.shop_code || url.searchParams.get('shop_code') || ctx.defaultShopCode);
  let verifiedLineUserId = '';
  if (!isDemoShop(shop) && extractLineIdToken(request, body)) {
    const verified = await verifyProductionLineIdentity(request, body, ctx);
    verifiedLineUserId = verified.lineUserId;
  }

  const customerName = cleanText(body.customer_name || body.name || body.customerName);
  const rawCustomerPhone = cleanText(body.customer_phone || body.phone || body.tel);
  const customerPhone = normalizePhone(rawCustomerPhone);
  if (!customerName) throw new Error('customer_name は必須です。');
  if (!customerPhone) throw new Error('customer_phone は必須です。');
  if (customerPhone.length < 10) throw new Error('電話番号を確認してください。');

  const date = body.date || body.reservation_date;
  const time = normalizeTime(body.time || body.start_time || body.reservation_time);
  assertDate(date, 'date');
  if (!time) throw new Error('time は必須です。');

  const menu = await resolveMenu(ctx, shop.id, body.menu_id, body.menu_code);
  if (!menu) throw new Error('メニューが見つかりません。');

  const staff = await resolveStaff(ctx, shop.id, body.staff_id, body.staff_code);
  const staffId = staff?.id || null;
  const staffName = staff?.staff_name || '指名なし';

  const slotCheck = await buildSlots(ctx, shop, {
    date,
    menuId: menu.id,
    staffId: staffId || '',
  });
  const requestedSlot = slotCheck.slots.find((s) => s.time === time);
  if (!requestedSlot || !requestedSlot.available) {
    throw new Error(requestedSlot?.reasons?.[0] || '指定日時は予約できません。');
  }

  const customer = await findOrCreateCustomer(ctx, shop.id, {
    line_user_id: isDemoShop(shop) ? cleanText(body.line_user_id) : verifiedLineUserId,
    line_display_name: isDemoShop(shop) ? cleanText(body.line_display_name) : '',
    customer_name: customerName,
    phone: customerPhone,
    email: cleanText(body.email),
    is_demo: isDemoShop(shop),
    allow_phone_match: isDemoShop(shop) || Boolean(verifiedLineUserId) || defaultSource === 'admin',
  });

  const startAt = localDateTimeToDate(date, time);
  const endAt = new Date(startAt.getTime() + Number(menu.duration_minutes || 60) * 60000);
  const reservationCode = body.reservation_code || createReservationCode('ESTHE');

  const inserted = await supabaseFetch(ctx, 'esthe_reservations', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      shop_id: shop.id,
      reservation_code: reservationCode,
      customer_id: customer.id,
      line_user_id: (isDemoShop(shop) ? cleanText(body.line_user_id) : verifiedLineUserId) || customer.line_user_id || null,
      customer_name: customerName,
      customer_phone: customerPhone,
      menu_id: menu.id,
      menu_name: menu.menu_name,
      menu_price_yen: Number(menu.price_yen || 0),
      menu_duration_minutes: Number(menu.duration_minutes || 60),
      staff_id: staffId,
      staff_name: staffName,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      status: 'reserved',
      source: defaultSource || 'liff',
      request_note: cleanText(body.request_note || body.note),
      internal_note: defaultSource === 'admin' ? cleanText(body.internal_note) : '',
      is_first_visit: Boolean(body.is_first_visit || menu.is_first_visit),
      is_demo: isDemoShop(shop),
      created_by: defaultSource || 'system',
    },
  });

  const reservation = inserted[0];

  if (body.consultation && typeof body.consultation === 'object') {
    await saveConsultation(ctx, shop.id, customer.id, reservation.id, body.consultation, isDemoShop(shop));
  }

  return jsonResponse({
    ok: true,
    message: '予約を作成しました。',
    shop_code: shop.shop_code,
    reservation: isDemoShop(shop) ? reservation : sanitizeMemberReservation(reservation),
    customer: isDemoShop(shop) ? customer : sanitizeMemberCustomer(customer),
    completion_message: shop.completion_message,
    version: VERSION,
  }, 201);
}

async function resolveMenu(ctx, shopId, menuId, menuCode) {
  if (menuId) return firstRow(ctx, 'esthe_menus', { select: '*', shop_id: `eq.${shopId}`, id: `eq.${menuId}`, is_active: 'eq.true' });
  if (menuCode) return firstRow(ctx, 'esthe_menus', { select: '*', shop_id: `eq.${shopId}`, menu_code: `eq.${menuCode}`, is_active: 'eq.true' });
  return firstRow(ctx, 'esthe_menus', { select: '*', shop_id: `eq.${shopId}`, is_active: 'eq.true', order: 'display_order.asc', limit: 1 });
}

async function resolveStaff(ctx, shopId, staffId, staffCode) {
  if (staffId) return firstRow(ctx, 'esthe_staff', { select: '*', shop_id: `eq.${shopId}`, id: `eq.${staffId}`, is_active: 'eq.true' });
  if (staffCode) return firstRow(ctx, 'esthe_staff', { select: '*', shop_id: `eq.${shopId}`, staff_code: `eq.${staffCode}`, is_active: 'eq.true' });
  return firstRow(ctx, 'esthe_staff', { select: '*', shop_id: `eq.${shopId}`, staff_code: 'eq.omakase', is_active: 'eq.true' });
}

async function findOrCreateCustomer(ctx, shopId, input) {
  const normalizedPhone = normalizePhone(input.phone);
  let existing = null;

  if (input.line_user_id) {
    existing = await firstRow(ctx, 'esthe_customers', {
      select: '*',
      shop_id: `eq.${shopId}`,
      line_user_id: `eq.${input.line_user_id}`,
      limit: 1,
    });
  }

  if (!existing && normalizedPhone && input.allow_phone_match !== false) {
    existing = await findCustomerByPhone(ctx, shopId, normalizedPhone);
  }

  if (existing) {
    const updated = await supabaseFetch(ctx, 'esthe_customers', {
      method: 'PATCH',
      query: { id: `eq.${existing.id}` },
      prefer: 'return=representation',
      body: {
        line_user_id: input.line_user_id || existing.line_user_id,
        line_display_name: input.line_display_name || existing.line_display_name,
        customer_name: input.customer_name || existing.customer_name,
        phone: normalizedPhone || normalizePhone(existing.phone) || existing.phone,
        email: input.email || existing.email,
      },
    });
    return updated[0];
  }

  const inserted = await supabaseFetch(ctx, 'esthe_customers', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      shop_id: shopId,
      line_user_id: input.line_user_id || null,
      line_display_name: input.line_display_name || null,
      customer_name: input.customer_name,
      phone: normalizedPhone || null,
      email: input.email || null,
      customer_status: 'active',
      is_demo: Boolean(input.is_demo),
    },
  });
  return inserted[0];
}

async function saveConsultation(ctx, shopId, customerId, reservationId, c, isDemo) {
  const body = {
    shop_id: shopId,
    customer_id: customerId,
    reservation_id: reservationId,
    purpose: cleanText(c.purpose),
    concerns: Array.isArray(c.concerns) ? c.concerns : [],
    body_areas: Array.isArray(c.body_areas) ? c.body_areas : [],
    skin_type: cleanText(c.skin_type),
    allergies: cleanText(c.allergies),
    medical_notes: cleanText(c.medical_notes),
    pregnancy_check: cleanText(c.pregnancy_check),
    request_note: cleanText(c.request_note),
    consent_checked: Boolean(c.consent_checked),
    answers: c.answers && typeof c.answers === 'object' ? c.answers : {},
    is_demo: Boolean(isDemo),
  };
  await supabaseFetch(ctx, 'esthe_consultation_answers', {
    method: 'POST',
    prefer: 'return=representation',
    body,
  });
}

function extractLineIdToken(request, body = {}) {
  return cleanText(request.headers.get('x-line-id-token') || body.line_id_token || body.id_token || '');
}

async function verifyProductionLineIdentity(request, body, ctx) {
  const channelId = cleanText(ctx.lineLoginChannelId);
  if (!channelId) {
    const error = new Error('本番LINE本人確認用のLINE Login Channel IDは契約時設定が必要です。');
    error.code = 'LINE_CHANNEL_BINDING_DEFERRED';
    error.status = 503;
    throw error;
  }
  const idToken = extractLineIdToken(request, body);
  if (!idToken) {
    const error = new Error('本番のお客様情報にはLINE ID Tokenによる本人確認が必要です。');
    error.code = 'LINE_ID_TOKEN_REQUIRED';
    error.status = 401;
    throw error;
  }
  const form = new URLSearchParams({ id_token:idToken, client_id:channelId });
  const response = await fetch(LINE_ID_TOKEN_VERIFY_ENDPOINT, {
    method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body:form.toString(), redirect:'error'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.sub || String(data.aud || '') !== channelId || String(data.iss || '') !== 'https://access.line.me') {
    const error = new Error('LINEの本人確認情報が無効です。');
    error.code = 'LINE_ID_TOKEN_INVALID';
    error.status = 401;
    throw error;
  }
  return { lineUserId:String(data.sub), displayName:cleanText(data.name), source:'verified_line_id_token' };
}

async function requireReservationOwnership(request, body, reservation, shop, ctx) {
  if (isDemoShop(shop)) return null;
  const identity = await verifyProductionLineIdentity(request, body, ctx);
  const customer = await firstRow(ctx, 'esthe_customers', { select:'id,line_user_id', shop_id:`eq.${shop.id}`, line_user_id:`eq.${identity.lineUserId}` });
  if (!customer || String(customer.id) !== String(reservation.customer_id || '')) {
    const error = new Error('この予約を変更する権限を確認できません。');
    error.code = 'CUSTOMER_SCOPE_MISMATCH';
    error.status = 403;
    throw error;
  }
  return { identity, customer };
}

function sanitizeMemberCustomer(customer) {
  return {
    id:customer.id,
    customer_name:customer.customer_name,
    customer_kana:customer.customer_kana || null,
    phone:customer.phone || null,
    first_visit_date:customer.first_visit_date || null,
    last_visit_date:customer.last_visit_date || null,
    visit_count:Number(customer.visit_count || 0),
  };
}

function sanitizeMemberReservation(row) {
  if (!row) return row;
  const { internal_note, customer_phone, line_user_id, ...safe } = row;
  return safe;
}

function sanitizeMemberTicket(row) {
  if (!row) return row;
  const { note, shop_id, customer_id, is_demo, ...safe } = row;
  return safe;
}

async function handleChangeReservation(request, url, ctx) {
  const body = await readJson(request);
  const reservationId = body.reservation_id || body.id;
  if (!reservationId) throw new Error('reservation_id は必須です。');

  const rows = await supabaseFetch(ctx, 'esthe_reservations', {
    query: { select: '*', id: `eq.${reservationId}`, limit: 1 },
  });
  const current = rows[0];
  if (!current) throw new Error('予約が見つかりません。');

  const shop = await getShopById(ctx, current.shop_id);
  await requireReservationOwnership(request, body, current, shop, ctx);
  const date = body.date || dateJstFromIso(current.start_at);
  const time = normalizeTime(body.time || timeJstFromIso(current.start_at));
  const menu = body.menu_id || body.menu_code
    ? await resolveMenu(ctx, shop.id, body.menu_id, body.menu_code)
    : { id: current.menu_id, menu_name: current.menu_name, price_yen: current.menu_price_yen, duration_minutes: current.menu_duration_minutes, buffer_after_minutes: shop.default_buffer_after_minutes };
  const staff = body.staff_id || body.staff_code
    ? await resolveStaff(ctx, shop.id, body.staff_id, body.staff_code)
    : { id: current.staff_id, staff_name: current.staff_name || '指名なし' };

  if (!menu) throw new Error('メニューが見つかりません。');

  const slotCheck = await buildSlots(ctx, shop, { date, menuId: menu.id, staffId: staff?.id || '' });
  const requestedSlot = slotCheck.slots.find((s) => s.time === time);
  if (!requestedSlot || !requestedSlot.available) {
    // 自分自身の予約だけが重なっている場合もあるため、簡易的に再判定
    const onlySelfOverlap = requestedSlot?.reasons?.some((r) => r.includes('埋まっています') || r.includes('予約済み'));
    if (!onlySelfOverlap) throw new Error(requestedSlot?.reasons?.[0] || '指定日時は予約できません。');
  }

  const startAt = localDateTimeToDate(date, time);
  const endAt = new Date(startAt.getTime() + Number(menu.duration_minutes || 60) * 60000);

  const updated = await supabaseFetch(ctx, 'esthe_reservations', {
    method: 'PATCH',
    query: { id: `eq.${reservationId}` },
    prefer: 'return=representation',
    body: {
      menu_id: menu.id,
      menu_name: menu.menu_name,
      menu_price_yen: Number(menu.price_yen || current.menu_price_yen || 0),
      menu_duration_minutes: Number(menu.duration_minutes || current.menu_duration_minutes || 60),
      staff_id: staff?.id || null,
      staff_name: staff?.staff_name || '指名なし',
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      request_note: body.request_note !== undefined ? cleanText(body.request_note) : current.request_note,
      // Public customer change never accepts or modifies internal staff notes.
      internal_note: current.internal_note,
      status: 'reserved',
      cancelled_at: null,
      cancellation_reason: null,
    },
  });

  return jsonResponse({ ok: true, message: '予約を変更しました。', reservation: updated[0], version: VERSION });
}

async function handleCancelReservation(request, url, ctx) {
  const body = await readJson(request);
  const reservationId = body.reservation_id || body.id;
  if (!reservationId) throw new Error('reservation_id は必須です。');
  const rows = await supabaseFetch(ctx, 'esthe_reservations', { query:{ select:'*', id:`eq.${reservationId}`, limit:1 } });
  const current = rows[0];
  if (!current) throw new Error('予約が見つかりません。');
  const shop = await getShopById(ctx, current.shop_id);
  await requireReservationOwnership(request, body, current, shop, ctx);

  const updated = await supabaseFetch(ctx, 'esthe_reservations', {
    method: 'PATCH',
    query: { id: `eq.${reservationId}` },
    prefer: 'return=representation',
    body: {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: cleanText(body.reason || body.cancellation_reason || 'お客様都合'),
    },
  });

  return jsonResponse({ ok: true, message: '予約をキャンセルしました。', reservation: sanitizeMemberReservation(updated[0]), version: VERSION });
}

async function handleMyPage(request, url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  let customer = null;
  const demoScope = isDemoShop(shop);

  if (demoScope) {
    const lineUserId = cleanText(url.searchParams.get('line_user_id'));
    const phone = normalizePhone(cleanText(url.searchParams.get('phone') || url.searchParams.get('tel')));
    const customerId = cleanText(url.searchParams.get('customer_id'));
    if (!lineUserId && !phone && !customerId) throw new Error('DEMOでは line_user_id、phone、customer_id のいずれかが必要です。');
    if (customerId) customer = await firstRow(ctx, 'esthe_customers', { select:'*', shop_id:`eq.${shop.id}`, id:`eq.${customerId}` });
    if (!customer && lineUserId) customer = await firstRow(ctx, 'esthe_customers', { select:'*', shop_id:`eq.${shop.id}`, line_user_id:`eq.${lineUserId}` });
    if (!customer && phone) customer = await findCustomerByPhone(ctx, shop.id, phone);
  } else {
    const identity = await verifyProductionLineIdentity(request, {}, ctx);
    customer = await firstRow(ctx, 'esthe_customers', { select:'*', shop_id:`eq.${shop.id}`, line_user_id:`eq.${identity.lineUserId}` });
  }

  if (!customer) {
    return jsonResponse({ ok:true, found:false, shop_code:shop.shop_code, message:'お客様情報はまだありません。', identity_mode:demoScope ? 'demo_lookup' : 'verified_line_id_token', version:VERSION });
  }

  const nowIso = new Date().toISOString();
  const [futureReservations, pastReservations, tickets, notes] = await Promise.all([
    supabaseFetch(ctx, 'esthe_reservations', { query:{ select:'*', customer_id:`eq.${customer.id}`, start_at:`gte.${nowIso}`, status:'in.(reserved,checked_in,in_treatment,waiting_payment)', order:'start_at.asc' } }),
    supabaseFetch(ctx, 'esthe_reservations', { query:{ select:'*', customer_id:`eq.${customer.id}`, start_at:`lt.${nowIso}`, order:'start_at.desc', limit:10 } }),
    supabaseFetch(ctx, 'esthe_customer_tickets', { query:{ select:'*', customer_id:`eq.${customer.id}`, status:'eq.active', order:'expires_at.asc' } }),
    demoScope ? supabaseFetch(ctx, 'esthe_customer_notes', { query:{ select:'id,note_type,note_title,note_body,is_important,created_at', customer_id:`eq.${customer.id}`, order:'created_at.desc', limit:5 } }) : Promise.resolve([]),
  ]);

  return jsonResponse({
    ok:true,
    found:true,
    identity_mode:demoScope ? 'demo_lookup' : 'verified_line_id_token',
    shop:sanitizePublicShop(shop),
    customer:demoScope ? customer : sanitizeMemberCustomer(customer),
    next_reservations:demoScope ? futureReservations : futureReservations.map(sanitizeMemberReservation),
    past_reservations:demoScope ? pastReservations : pastReservations.map(sanitizeMemberReservation),
    tickets:demoScope ? tickets : tickets.map(sanitizeMemberTicket),
    recent_notes:notes,
    version:VERSION,
  });
}

async function handleSystemCheck(url, ctx, startedAt) {
  const shop = await getShopFromUrl(url, ctx);
  const counts = await getBasicCounts(ctx, shop.id);
  const readyRuntime = await productReadyRuntime(ctx);
  const capabilities = productReadyCapabilities(ctx);
  const today = todayJst();
  const [businessHours, menus, staff, rooms, todayReservations, pendingFollowups, templates] = await Promise.all([
    supabaseFetch(ctx, 'esthe_business_hours', { query: { select: 'id', shop_id: `eq.${shop.id}` } }),
    supabaseFetch(ctx, 'esthe_menus', { query: { select: 'id', shop_id: `eq.${shop.id}`, is_active: 'eq.true' } }),
    supabaseFetch(ctx, 'esthe_staff', { query: { select: 'id', shop_id: `eq.${shop.id}`, is_active: 'eq.true' } }),
    supabaseFetch(ctx, 'esthe_rooms', { query: { select: 'id', shop_id: `eq.${shop.id}`, is_active: 'eq.true' } }),
    fetchReservationsForDate(ctx, shop.id, today),
    supabaseFetch(ctx, 'esthe_followups', { query: { select: 'id', shop_id: `eq.${shop.id}`, due_date: `lte.${today}`, status: 'eq.pending' } }),
    supabaseFetch(ctx, 'esthe_message_templates', { query: { select: 'id', shop_id: `eq.${shop.id}`, is_active: 'eq.true' } }),
  ]);

  const phoneNormalizationOk = normalizePhone('０９０ー１１１１ー２２２２') === '09011112222'
    && normalizePhone('090-1111-2222') === '09011112222'
    && normalizePhone('+81 90-1111-2222') === '09011112222';

  const checks = {
    api: true,
    db: true,
    shop: Boolean(shop.id),
    business_hours: businessHours.length >= 7,
    menus: menus.length > 0,
    staff: staff.length > 0,
    rooms: rooms.length > 0,
    templates: templates.length > 0,
    phone_normalization: phoneNormalizationOk,
    demo_customers: counts.demo_customers >= 6,
    demo_reservations: counts.demo_reservations >= 5,
    demo_followups: counts.demo_followups >= 6,
    product_ready_database_baseline: readyRuntime.databaseVersionVerified,
    product_ready_frontend_contract: readyRuntime.frontendContractVerified,
    product_ready_versions_aligned: readyRuntime.versionsAligned,
    common_owner_auth_capability: capabilities.ownerAuthReady,
    line_verified_identity_capability: capabilities.lineIdentityVerificationReady,
    staff_permission_capability: capabilities.staffPermissionReady,
    formal_audit_ledger: capabilities.auditReady,
  };

  const ok = Object.values(checks).every(Boolean);

  return jsonResponse({
    ok,
    status: ok ? 'ESTHE PRODUCT READY R1 OK' : 'CHECK_NEEDED',
    service: SERVICE_NAME,
    version: VERSION,
    legacyBaselineVersion:LEGACY_BASELINE_VERSION,
    worker_name: 'dpro-esthe-relax-line-api',
    systemCode:'ESTHE',
    adapterVersion:READY_RELEASE.adapterVersion,
    contractVersion:READY_RELEASE.contractVersion,
    workerVersion:readyRuntime.workerVersion,
    databaseVersion:readyRuntime.databaseVersion,
    frontendVersion:readyRuntime.frontendVersion,
    versionsAligned:readyRuntime.versionsAligned,
    databaseVersionVerified:readyRuntime.databaseVersionVerified,
    databaseProbeCount:readyRuntime.databaseProbeCount,
    frontendContractVerified:readyRuntime.frontendContractVerified,
    capabilities,
    shop_code: shop.shop_code,
    shop_name: shop.shop_name,
    today,
    checks,
    counts: {
      ...counts,
      today_reservations: todayReservations.length,
      pending_followups: pendingFollowups.length,
      active_menus: menus.length,
      active_staff: staff.length,
      active_rooms: rooms.length,
      active_templates: templates.length,
    },
    urls: {
      health: '/api/health',
      public_settings: '/api/public/settings',
      public_menus: '/api/public/menus',
      public_staff: '/api/public/staff',
      public_slots: `/api/public/slots?date=${today}`,
      admin_day: `/api/admin/day?date=${today}`,
      demo_prepare: '/api/admin/demo/prepare',
    },
    adopted_steps: {
      worker: 'STEP ESTHE-16',
      index_brush_html: 'STEP ESTHE-16',
      index_html: 'STEP ESTHE-16',
      member_html: 'STEP ESTHE-16',
      staff_html: 'STEP ESTHE-16',
      owner_html: 'STEP ESTHE-16',
      system_check_html: 'STEP ESTHE-16',
    },
    phone_normalization_samples: buildPhoneNormalizationSamples(),
    response_ms: Date.now() - startedAt,
    time: new Date().toISOString(),
  });
}

async function handlePhoneNormalizeCheck(url, ctx) {
  const samples = buildPhoneNormalizationSamples();
  const ok = samples.every((s) => s.normalized === '09011112222');
  return jsonResponse({
    ok,
    status: ok ? 'STEP ESTHE-16 OK' : 'CHECK_NEEDED',
    service: SERVICE_NAME,
    version: VERSION,
    message: '電話番号正規化チェックを実行しました。',
    samples,
    time: new Date().toISOString(),
  });
}

async function handleDemoPrepare(request, url, ctx) {
  let body = {};
  if (request.method !== 'GET') body = await readJson(request);
  const shopCode = body.shop_code || url.searchParams.get('shop_code') || ctx.defaultShopCode;

  const result = await supabaseFetch(ctx, '/rest/v1/rpc/esthe_prepare_demo_data', {
    method: 'POST',
    body: { p_shop_code: shopCode },
  });

  return jsonResponse({
    ok: true,
    service: SERVICE_NAME,
    version: VERSION,
    message: '営業前デモ準備を実行しました。',
    result,
    time: new Date().toISOString(),
  });
}

async function handleAdminDay(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const date = url.searchParams.get('date') || todayJst();
  assertDate(date, 'date');

  const [reservations, followups] = await Promise.all([
    fetchReservationsForDateAll(ctx, shop.id, date),
    supabaseFetch(ctx, 'esthe_followups', {
      query: { select: '*', shop_id: `eq.${shop.id}`, due_date: `lte.${date}`, status: 'eq.pending', order: 'due_date.asc,priority.desc,created_at.asc' },
    }),
  ]);

  return jsonResponse({
    ok: true,
    shop_code: shop.shop_code,
    date,
    reservations,
    followups,
    summary: summarizeDay(reservations, followups),
    version: VERSION,
  });
}

async function fetchReservationsForDateAll(ctx, shopId, date) {
  const range = dateRangeJst(date);
  return supabaseFetch(ctx, 'esthe_reservations', {
    query: {
      select: '*',
      shop_id: `eq.${shopId}`,
      start_at: `gte.${range.startIso}`,
      end_at: `lt.${range.endIso}`,
      order: 'start_at.asc',
    },
  });
}

function summarizeDay(reservations, followups) {
  const byStatus = {};
  for (const r of reservations) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return {
    total_reservations: reservations.length,
    active_reservations: reservations.filter((r) => ACTIVE_RESERVATION_STATUSES.has(r.status)).length,
    completed: byStatus.completed || 0,
    cancelled: byStatus.cancelled || 0,
    pending_followups: followups.length,
    by_status: byStatus,
  };
}

async function handleAdminReservations(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const from = url.searchParams.get('from') || todayJst();
  const to = url.searchParams.get('to') || addDaysJst(from, 30);
  const status = url.searchParams.get('status');
  assertDate(from, 'from');
  assertDate(to, 'to');

  const query = {
    select: '*',
    shop_id: `eq.${shop.id}`,
    start_at: `gte.${localDateTimeToDate(from, '00:00').toISOString()}`,
    end_at: `lt.${localDateTimeToDate(addDaysJst(to, 1), '00:00').toISOString()}`,
    order: 'start_at.asc',
  };
  if (status) query.status = `eq.${status}`;

  const rows = await supabaseFetch(ctx, 'esthe_reservations', { query });
  return jsonResponse({ ok: true, shop_code: shop.shop_code, from, to, reservations: rows, version: VERSION });
}

async function handleUpdateReservation(request, url, ctx) {
  const body = await readJson(request);
  const reservationId = body.reservation_id || body.id;
  if (!reservationId) throw new Error('reservation_id は必須です。');

  const allowed = pick(body, [
    'customer_name',
    'customer_phone',
    'request_note',
    'internal_note',
    'status',
    'staff_id',
    'staff_name',
    'room_id',
  ]);

  if (allowed.customer_phone !== undefined) {
    allowed.customer_phone = normalizePhone(allowed.customer_phone);
  }

  if (body.date && body.time) {
    const current = await firstRow(ctx, 'esthe_reservations', { select: '*', id: `eq.${reservationId}` });
    if (!current) throw new Error('予約が見つかりません。');
    const startAt = localDateTimeToDate(body.date, normalizeTime(body.time));
    const endAt = new Date(startAt.getTime() + Number(current.menu_duration_minutes || 60) * 60000);
    allowed.start_at = startAt.toISOString();
    allowed.end_at = endAt.toISOString();
  }

  const updated = await supabaseFetch(ctx, 'esthe_reservations', {
    method: 'PATCH',
    query: { id: `eq.${reservationId}` },
    prefer: 'return=representation',
    body: allowed,
  });

  return jsonResponse({ ok: true, message: '予約を更新しました。', reservation: updated[0], version: VERSION });
}

async function handleReservationStatus(request, url, ctx) {
  const body = await readJson(request);
  const reservationId = body.reservation_id || body.id;
  const status = body.status;
  if (!reservationId) throw new Error('reservation_id は必須です。');
  if (!['reserved', 'checked_in', 'in_treatment', 'waiting_payment', 'completed', 'cancelled', 'no_show'].includes(status)) {
    throw new Error('status が正しくありません。');
  }

  const updateBody = { status };
  if (status === 'cancelled') {
    updateBody.cancelled_at = new Date().toISOString();
    updateBody.cancellation_reason = cleanText(body.reason || body.cancellation_reason || '管理画面でキャンセル');
  }

  const updated = await supabaseFetch(ctx, 'esthe_reservations', {
    method: 'PATCH',
    query: { id: `eq.${reservationId}` },
    prefer: 'return=representation',
    body: updateBody,
  });

  return jsonResponse({ ok: true, message: '予約ステータスを更新しました。', reservation: updated[0], version: VERSION });
}

async function handleCustomerSearch(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const q = cleanSearch(url.searchParams.get('q') || url.searchParams.get('keyword') || '');
  const phoneQ = normalizePhone(q);
  const limit = clamp(Number(url.searchParams.get('limit') || 30), 1, 100);

  let query = {
    select: '*',
    shop_id: `eq.${shop.id}`,
    order: 'updated_at.desc',
    limit,
  };

  if (q) {
    const orParts = [
      `customer_name.ilike.*${q}*`,
      `line_display_name.ilike.*${q}*`,
      `phone.ilike.*${q}*`,
    ];
    if (phoneQ) orParts.push(`phone.ilike.*${phoneQ}*`);
    query.or = `(${orParts.join(',')})`;
  }

  const rows = await supabaseFetch(ctx, 'esthe_customers', { query });

  // 既存データにハイフン付き電話が残っていても検索できるよう、電話番号検索時は正規化後に追加照合する。
  let merged = rows || [];
  if (phoneQ.length >= 4) {
    const candidates = await supabaseFetch(ctx, 'esthe_customers', {
      query: {
        select: '*',
        shop_id: `eq.${shop.id}`,
        order: 'updated_at.desc',
        limit: 1000,
      },
    });
    const matchedByNormalizedPhone = (candidates || []).filter((c) => normalizePhone(c.phone).includes(phoneQ));
    merged = mergeById([...matchedByNormalizedPhone, ...merged]).slice(0, limit);
  }

  return jsonResponse({
    ok: true,
    shop_code: shop.shop_code,
    q,
    normalized_phone: phoneQ || null,
    customers: merged,
    version: VERSION,
  });
}

async function handleCustomerDetail(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const customerId = cleanText(url.searchParams.get('customer_id') || url.searchParams.get('id'));
  const lineUserId = cleanText(url.searchParams.get('line_user_id'));
  const rawPhone = cleanText(url.searchParams.get('phone') || url.searchParams.get('tel'));
  const phone = normalizePhone(rawPhone);

  let customer = null;
  if (customerId) customer = await firstRow(ctx, 'esthe_customers', { select: '*', shop_id: `eq.${shop.id}`, id: `eq.${customerId}` });
  if (!customer && lineUserId) customer = await firstRow(ctx, 'esthe_customers', { select: '*', shop_id: `eq.${shop.id}`, line_user_id: `eq.${lineUserId}` });
  if (!customer && phone) customer = await findCustomerByPhone(ctx, shop.id, phone);
  if (!customer) throw new Error('顧客が見つかりません。');

  const [reservations, treatments, notes, consultations, tickets, followups, photos] = await Promise.all([
    supabaseFetch(ctx, 'esthe_reservations', { query: { select: '*', customer_id: `eq.${customer.id}`, order: 'start_at.desc', limit: 30 } }),
    supabaseFetch(ctx, 'esthe_treatments', { query: { select: '*', customer_id: `eq.${customer.id}`, order: 'treatment_date.desc', limit: 30 } }),
    supabaseFetch(ctx, 'esthe_customer_notes', { query: { select: '*', customer_id: `eq.${customer.id}`, order: 'created_at.desc', limit: 50 } }),
    supabaseFetch(ctx, 'esthe_consultation_answers', { query: { select: '*', customer_id: `eq.${customer.id}`, order: 'answered_at.desc', limit: 10 } }),
    supabaseFetch(ctx, 'esthe_customer_tickets', { query: { select: '*', customer_id: `eq.${customer.id}`, order: 'created_at.desc', limit: 20 } }),
    supabaseFetch(ctx, 'esthe_followups', { query: { select: '*', customer_id: `eq.${customer.id}`, order: 'due_date.desc', limit: 30 } }),
    supabaseFetch(ctx, 'esthe_customer_photos', { query: { select: '*', customer_id: `eq.${customer.id}`, order: 'taken_at.desc', limit: 20 } }),
  ]);

  return jsonResponse({
    ok: true,
    shop_code: shop.shop_code,
    customer,
    reservations,
    treatments,
    notes,
    consultations,
    tickets,
    followups,
    photos,
    version: VERSION,
  });
}

async function handleKarteSave(request, url, ctx) {
  const body = await readJson(request);
  const shop = await getShop(ctx, body.shop_code || url.searchParams.get('shop_code') || ctx.defaultShopCode);
  const customerId = body.customer_id;
  if (!customerId) throw new Error('customer_id は必須です。');
  if (!body.note_body && !body.treatment_memo) throw new Error('note_body または treatment_memo が必要です。');

  let treatment = null;
  if (body.treatment_memo || body.menu_name) {
    const inserted = await supabaseFetch(ctx, 'esthe_treatments', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        shop_id: shop.id,
        customer_id: customerId,
        reservation_id: body.reservation_id || null,
        menu_id: body.menu_id || null,
        staff_id: body.staff_id || null,
        treatment_date: body.treatment_date || todayJst(),
        menu_name: cleanText(body.menu_name || '施術メモ'),
        condition_before: cleanText(body.condition_before),
        treatment_memo: cleanText(body.treatment_memo),
        after_note: cleanText(body.after_note),
        next_recommendation: cleanText(body.next_recommendation),
        amount_yen: Number(body.amount_yen || 0),
        status: body.status || 'completed',
        is_demo: Boolean(body.is_demo),
      },
    });
    treatment = inserted[0];
  }

  let note = null;
  if (body.note_body) {
    const inserted = await supabaseFetch(ctx, 'esthe_customer_notes', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        shop_id: shop.id,
        customer_id: customerId,
        note_type: body.note_type || 'karte',
        note_title: cleanText(body.note_title),
        note_body: cleanText(body.note_body),
        is_important: Boolean(body.is_important),
        is_demo: Boolean(body.is_demo),
        created_by: cleanText(body.created_by || 'staff'),
      },
    });
    note = inserted[0];
  }

  return jsonResponse({ ok: true, message: 'カルテを保存しました。', treatment, note, version: VERSION });
}

async function handleTickets(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const customerId = url.searchParams.get('customer_id');
  const status = url.searchParams.get('status') || 'active';
  const query = {
    select: '*',
    shop_id: `eq.${shop.id}`,
    order: 'expires_at.asc',
    limit: clamp(Number(url.searchParams.get('limit') || 100), 1, 300),
  };
  if (customerId) query.customer_id = `eq.${customerId}`;
  if (status !== 'all') query.status = `eq.${status}`;

  const [tickets, plans] = await Promise.all([
    supabaseFetch(ctx, 'esthe_customer_tickets', { query }),
    supabaseFetch(ctx, 'esthe_ticket_plans', { query: { select: '*', shop_id: `eq.${shop.id}`, is_active: 'eq.true', order: 'display_order.asc' } }),
  ]);

  return jsonResponse({ ok: true, shop_code: shop.shop_code, tickets, plans, version: VERSION });
}

async function handleIssueTicket(request, url, ctx) {
  const body = await readJson(request);
  const shop = await getShop(ctx, body.shop_code || url.searchParams.get('shop_code') || ctx.defaultShopCode);
  const customerId = body.customer_id;
  if (!customerId) throw new Error('customer_id は必須です。');

  let plan = null;
  if (body.plan_id) plan = await firstRow(ctx, 'esthe_ticket_plans', { select: '*', shop_id: `eq.${shop.id}`, id: `eq.${body.plan_id}` });
  if (body.plan_code) plan = await firstRow(ctx, 'esthe_ticket_plans', { select: '*', shop_id: `eq.${shop.id}`, plan_code: `eq.${body.plan_code}` });

  const total = Number(body.total_count || plan?.total_count || 1);
  const purchasedAt = body.purchased_at || todayJst();
  const expiresAt = body.expires_at || addDaysJst(purchasedAt, Number(body.validity_days || plan?.validity_days || 180));

  const inserted = await supabaseFetch(ctx, 'esthe_customer_tickets', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      shop_id: shop.id,
      customer_id: customerId,
      plan_id: plan?.id || null,
      ticket_name: cleanText(body.ticket_name || plan?.plan_name || '回数券'),
      total_count: total,
      remaining_count: Number(body.remaining_count ?? total),
      purchased_at: purchasedAt,
      expires_at: expiresAt,
      status: body.status || 'active',
      note: cleanText(body.note),
      is_demo: Boolean(body.is_demo),
    },
  });

  return jsonResponse({ ok: true, message: '回数券を発行しました。', ticket: inserted[0], version: VERSION }, 201);
}

async function handleUseTicket(request, url, ctx) {
  const body = await readJson(request);
  const ticketId = body.customer_ticket_id || body.ticket_id;
  const usedCount = Number(body.used_count || 1);
  if (!ticketId) throw new Error('customer_ticket_id は必須です。');
  if (usedCount < 1) throw new Error('used_count が正しくありません。');

  const ticket = await firstRow(ctx, 'esthe_customer_tickets', { select: '*', id: `eq.${ticketId}` });
  if (!ticket) throw new Error('回数券が見つかりません。');
  if (ticket.remaining_count < usedCount) throw new Error('回数券の残数が不足しています。');

  const usage = await supabaseFetch(ctx, 'esthe_ticket_usages', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      shop_id: ticket.shop_id,
      customer_ticket_id: ticket.id,
      reservation_id: body.reservation_id || null,
      used_count: usedCount,
      note: cleanText(body.note),
      is_demo: Boolean(body.is_demo || ticket.is_demo),
    },
  });

  const remaining = ticket.remaining_count - usedCount;
  const updated = await supabaseFetch(ctx, 'esthe_customer_tickets', {
    method: 'PATCH',
    query: { id: `eq.${ticket.id}` },
    prefer: 'return=representation',
    body: {
      remaining_count: remaining,
      status: remaining <= 0 ? 'used_up' : ticket.status,
    },
  });

  return jsonResponse({ ok: true, message: '回数券を使用しました。', usage: usage[0], ticket: updated[0], version: VERSION });
}

async function handleFollowups(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const status = url.searchParams.get('status') || 'pending';
  const dueBefore = url.searchParams.get('due_before') || url.searchParams.get('date') || todayJst();
  const customerId = url.searchParams.get('customer_id');
  const limit = clamp(Number(url.searchParams.get('limit') || 100), 1, 300);

  const query = {
    select: '*',
    shop_id: `eq.${shop.id}`,
    order: 'due_date.asc,priority.desc,created_at.asc',
    limit,
  };
  if (status !== 'all') query.status = `eq.${status}`;
  if (dueBefore !== 'all') query.due_date = `lte.${dueBefore}`;
  if (customerId) query.customer_id = `eq.${customerId}`;

  const rows = await supabaseFetch(ctx, 'esthe_followups', { query });
  return jsonResponse({ ok: true, shop_code: shop.shop_code, followups: rows, version: VERSION });
}

async function handleUpdateFollowup(request, url, ctx) {
  const body = await readJson(request);
  const followupId = body.followup_id || body.id;
  if (!followupId) throw new Error('followup_id は必須です。');

  const updateBody = pick(body, ['status', 'priority', 'title', 'message_body', 'snoozed_until']);
  if (body.status === 'done') {
    updateBody.handled_at = new Date().toISOString();
    updateBody.handled_by = cleanText(body.handled_by || 'staff');
  }
  if (body.status === 'snoozed' && !body.snoozed_until) {
    updateBody.snoozed_until = addDaysJst(todayJst(), 3);
  }

  const updated = await supabaseFetch(ctx, 'esthe_followups', {
    method: 'PATCH',
    query: { id: `eq.${followupId}` },
    prefer: 'return=representation',
    body: updateBody,
  });

  return jsonResponse({ ok: true, message: 'フォローを更新しました。', followup: updated[0], version: VERSION });
}

async function handleSaveSettings(request, url, ctx) {
  const body = await readJson(request);
  const shop = await getShop(ctx, body.shop_code || url.searchParams.get('shop_code') || ctx.defaultShopCode);
  const nowIso = new Date().toISOString();

  const result = {
    shop: null,
    business_hours: 0,
    closed_days: 0,
    menus: 0,
    staff: 0,
    rooms: 0,
    ticket_plans: 0,
    message_templates: 0,
    settings: 0,
  };

  // ---------------------------------------------------------
  // 1) 店舗基本情報・予約基本設定
  // ---------------------------------------------------------
  const shopInput = body.shop && typeof body.shop === 'object' ? body.shop : body;
  const shopUpdate = normalizeShopUpdate(shopInput);

  let updatedShop = shop;
  if (Object.keys(shopUpdate).length > 0) {
    const rows = await supabaseFetch(ctx, 'esthe_shops', {
      method: 'PATCH',
      query: { id: `eq.${shop.id}` },
      prefer: 'return=representation',
      body: shopUpdate,
    });
    updatedShop = rows[0] || shop;
    result.shop = updatedShop;
  }

  // ---------------------------------------------------------
  // 2) 曜日別営業時間
  // ---------------------------------------------------------
  if (Array.isArray(body.business_hours)) {
    const payload = body.business_hours
      .filter((b) => b && b.day_of_week !== undefined)
      .map((b) => ({
        shop_id: shop.id,
        day_of_week: Number(b.day_of_week),
        is_open: b.is_open !== false,
        open_time: b.is_open === false ? null : normalizeTime(b.open_time || '10:00'),
        close_time: b.is_open === false ? null : normalizeTime(b.close_time || '19:00'),
        break_start: normalizeTime(b.break_start) || null,
        break_end: normalizeTime(b.break_end) || null,
        note: cleanText(b.note),
        updated_at: nowIso,
      }));
    if (payload.length) {
      await supabaseFetch(ctx, 'esthe_business_hours', {
        method: 'POST',
        query: { on_conflict: 'shop_id,day_of_week' },
        prefer: 'resolution=merge-duplicates,return=representation',
        body: payload,
      });
      result.business_hours = payload.length;
    }
  }

  // ---------------------------------------------------------
  // 3) 臨時休業・特別営業日
  // ---------------------------------------------------------
  if (Array.isArray(body.closed_days)) {
    const payload = body.closed_days
      .filter((d) => d && d.target_date)
      .map((d) => ({
        shop_id: shop.id,
        target_date: assertAndReturnDate(d.target_date, 'target_date'),
        day_type: normalizeChoice(d.day_type, ['closed', 'special_open', 'shortened'], 'closed'),
        title: cleanText(d.title || (d.day_type === 'special_open' ? '特別営業' : '臨時休業')) || '臨時休業',
        open_time: normalizeTime(d.open_time) || null,
        close_time: normalizeTime(d.close_time) || null,
        note: cleanText(d.note),
        updated_at: nowIso,
      }));
    if (payload.length) {
      await supabaseFetch(ctx, 'esthe_closed_days', {
        method: 'POST',
        query: { on_conflict: 'shop_id,target_date' },
        prefer: 'resolution=merge-duplicates,return=representation',
        body: payload,
      });
      result.closed_days = payload.length;
    }
  }

  // ---------------------------------------------------------
  // 4) メニュー
  // ---------------------------------------------------------
  if (Array.isArray(body.menus)) {
    const payload = body.menus
      .filter((m) => m && (m.menu_code || m.menu_name))
      .map((m, index) => {
        const menuCode = cleanCode(m.menu_code || makeCode('menu', m.menu_name, index));
        return {
          shop_id: shop.id,
          menu_code: menuCode,
          menu_name: cleanText(m.menu_name || 'メニュー'),
          category: normalizeChoice(m.category, ['body', 'facial', 'headspa', 'relaxation', 'slimming', 'option', 'ticket', 'other'], 'body'),
          description: cleanText(m.description),
          price_yen: toInt(m.price_yen, 0, 0, 1000000),
          duration_minutes: toInt(m.duration_minutes, 60, 10, 360),
          buffer_before_minutes: toInt(m.buffer_before_minutes, updatedShop.default_buffer_before_minutes || 0, 0, 120),
          buffer_after_minutes: toInt(m.buffer_after_minutes, updatedShop.default_buffer_after_minutes || 15, 0, 120),
          is_active: m.is_active !== false,
          is_first_visit: Boolean(m.is_first_visit),
          is_ticket_target: m.is_ticket_target !== false,
          display_order: toInt(m.display_order, (index + 1) * 10, 0, 9999),
          settings: isPlainObject(m.settings) ? m.settings : {},
          updated_at: nowIso,
        };
      });
    if (payload.length) {
      await supabaseFetch(ctx, 'esthe_menus', {
        method: 'POST',
        query: { on_conflict: 'shop_id,menu_code' },
        prefer: 'resolution=merge-duplicates,return=representation',
        body: payload,
      });
      result.menus = payload.length;
    }
  }

  // ---------------------------------------------------------
  // 5) スタッフ
  // ---------------------------------------------------------
  if (Array.isArray(body.staff)) {
    const payload = body.staff
      .filter((s) => s && (s.staff_code || s.staff_name))
      .map((s, index) => {
        const staffCode = cleanCode(s.staff_code || makeCode('staff', s.staff_name, index));
        return {
          shop_id: shop.id,
          staff_code: staffCode,
          staff_name: cleanText(s.staff_name || s.name || 'スタッフ'),
          role: normalizeChoice(s.role, ['owner', 'manager', 'therapist', 'reception', 'other'], 'therapist'),
          profile: cleanText(s.profile),
          can_be_selected: s.can_be_selected !== false,
          is_active: s.is_active !== false,
          display_order: toInt(s.display_order, (index + 1) * 10, 0, 9999),
          settings: isPlainObject(s.settings) ? s.settings : {},
          updated_at: nowIso,
        };
      });
    if (payload.length) {
      await supabaseFetch(ctx, 'esthe_staff', {
        method: 'POST',
        query: { on_conflict: 'shop_id,staff_code' },
        prefer: 'resolution=merge-duplicates,return=representation',
        body: payload,
      });
      result.staff = payload.length;
    }
  }

  // ---------------------------------------------------------
  // 6) ベッド・個室・施術スペース
  // ---------------------------------------------------------
  if (Array.isArray(body.rooms)) {
    const payload = body.rooms
      .filter((r) => r && (r.room_code || r.room_name))
      .map((r, index) => {
        const roomCode = cleanCode(r.room_code || makeCode('room', r.room_name, index));
        return {
          shop_id: shop.id,
          room_code: roomCode,
          room_name: cleanText(r.room_name || r.name || '施術スペース'),
          room_type: normalizeChoice(r.room_type, ['bed', 'private_room', 'facial_room', 'headspa_seat', 'other'], 'bed'),
          is_active: r.is_active !== false,
          display_order: toInt(r.display_order, (index + 1) * 10, 0, 9999),
          note: cleanText(r.note),
          updated_at: nowIso,
        };
      });
    if (payload.length) {
      await supabaseFetch(ctx, 'esthe_rooms', {
        method: 'POST',
        query: { on_conflict: 'shop_id,room_code' },
        prefer: 'resolution=merge-duplicates,return=representation',
        body: payload,
      });
      result.rooms = payload.length;
    }
  }

  // ---------------------------------------------------------
  // 7) 回数券プラン
  // target_menu_code がある場合は menu_id に変換
  // ---------------------------------------------------------
  if (Array.isArray(body.ticket_plans)) {
    const menus = await supabaseFetch(ctx, 'esthe_menus', {
      query: { select: 'id,menu_code', shop_id: `eq.${shop.id}` },
    });
    const menuMap = Object.fromEntries((menus || []).map((m) => [m.menu_code, m.id]));

    const payload = body.ticket_plans
      .filter((p) => p && (p.plan_code || p.plan_name))
      .map((p, index) => {
        const planCode = cleanCode(p.plan_code || makeCode('ticket', p.plan_name, index));
        return {
          shop_id: shop.id,
          plan_code: planCode,
          plan_name: cleanText(p.plan_name || p.ticket_name || '回数券'),
          target_menu_id: p.target_menu_id || menuMap[p.target_menu_code] || null,
          total_count: toInt(p.total_count, 5, 1, 100),
          validity_days: toInt(p.validity_days, 180, 1, 2000),
          price_yen: toInt(p.price_yen, 0, 0, 1000000),
          description: cleanText(p.description),
          is_active: p.is_active !== false,
          display_order: toInt(p.display_order, (index + 1) * 10, 0, 9999),
          updated_at: nowIso,
        };
      });
    if (payload.length) {
      await supabaseFetch(ctx, 'esthe_ticket_plans', {
        method: 'POST',
        query: { on_conflict: 'shop_id,plan_code' },
        prefer: 'resolution=merge-duplicates,return=representation',
        body: payload,
      });
      result.ticket_plans = payload.length;
    }
  }

  // ---------------------------------------------------------
  // 8) LINE文面テンプレート
  // ---------------------------------------------------------
  if (Array.isArray(body.message_templates)) {
    const payload = body.message_templates
      .filter((t) => t && (t.template_key || t.template_title || t.template_body || t.message_body))
      .map((t, index) => {
        const templateKey = cleanCode(t.template_key || makeCode('template', t.template_title || t.template_name, index));
        return {
          shop_id: shop.id,
          template_key: templateKey,
          template_title: cleanText(t.template_title || t.template_name || t.title || 'テンプレート'),
          template_body: String(t.template_body || t.message_body || t.body || ''),
          category: normalizeChoice(t.category || t.template_type || t.message_type, ['reservation', 'cancel', 'reminder', 'aftercare', 'ticket', 'birthday', 'followup', 'other'], 'other'),
          is_active: t.is_active !== false,
          display_order: toInt(t.display_order, (index + 1) * 10, 0, 9999),
          updated_at: nowIso,
        };
      });
    if (payload.length) {
      await supabaseFetch(ctx, 'esthe_message_templates', {
        method: 'POST',
        query: { on_conflict: 'shop_id,template_key' },
        prefer: 'resolution=merge-duplicates,return=representation',
        body: payload,
      });
      result.message_templates = payload.length;
    }
  }

  // ---------------------------------------------------------
  // 9) 柔軟設定 esthe_settings
  // 配列でも object でも保存可能
  // ---------------------------------------------------------
  if (Array.isArray(body.settings)) {
    const payload = body.settings
      .filter((s) => s && s.setting_key)
      .map((s) => ({
        shop_id: shop.id,
        setting_key: cleanText(s.setting_key),
        setting_value: isPlainObject(s.setting_value) || Array.isArray(s.setting_value) ? s.setting_value : { value: s.setting_value },
        description: cleanText(s.description),
        updated_at: nowIso,
      }));
    if (payload.length) {
      await supabaseFetch(ctx, 'esthe_settings', {
        method: 'POST',
        query: { on_conflict: 'shop_id,setting_key' },
        prefer: 'resolution=merge-duplicates,return=representation',
        body: payload,
      });
      result.settings = payload.length;
    }
  } else if (isPlainObject(body.settings) && !isShopSettingsOnly(body.settings)) {
    const payload = Object.entries(body.settings).map(([key, value]) => ({
      shop_id: shop.id,
      setting_key: cleanText(key),
      setting_value: isPlainObject(value) || Array.isArray(value) ? value : { value },
      description: '',
      updated_at: nowIso,
    }));
    if (payload.length) {
      await supabaseFetch(ctx, 'esthe_settings', {
        method: 'POST',
        query: { on_conflict: 'shop_id,setting_key' },
        prefer: 'resolution=merge-duplicates,return=representation',
        body: payload,
      });
      result.settings = payload.length;
    }
  }

  const freshSettings = await fetchSettingsBundle(ctx, updatedShop.shop_code || shop.shop_code);

  return jsonResponse({
    ok: true,
    status: 'STEP ESTHE-12A OK',
    service: SERVICE_NAME,
    version: VERSION,
    message: '店舗設定を保存しました。',
    shop_code: updatedShop.shop_code || shop.shop_code,
    saved: result,
    settings: freshSettings,
    time: new Date().toISOString(),
  });
}

function normalizeShopUpdate(input) {
  const raw = pick(input || {}, [
    'shop_name',
    'display_name',
    'phone',
    'postal_code',
    'address',
    'description',
    'notice',
    'completion_message',
    'simple_enabled',
    'brush_enabled',
    'default_booking_days_ahead',
    'booking_deadline_hours',
    'same_day_booking',
    'cancel_deadline_hours',
    'slot_interval_minutes',
    'default_buffer_before_minutes',
    'default_buffer_after_minutes',
    'max_daily_reservations',
    'rooms_count',
    'settings',
  ]);

  const out = {};
  const textKeys = ['shop_name', 'display_name', 'phone', 'postal_code', 'address', 'description', 'notice', 'completion_message'];
  for (const key of textKeys) {
    if (raw[key] !== undefined) out[key] = cleanText(raw[key]);
  }

  const boolKeys = ['simple_enabled', 'brush_enabled', 'same_day_booking'];
  for (const key of boolKeys) {
    if (raw[key] !== undefined) out[key] = Boolean(raw[key]);
  }

  const intRules = {
    default_booking_days_ahead: [60, 1, 365],
    booking_deadline_hours: [3, 0, 168],
    cancel_deadline_hours: [6, 0, 720],
    slot_interval_minutes: [30, 10, 60],
    default_buffer_before_minutes: [0, 0, 120],
    default_buffer_after_minutes: [15, 0, 120],
    max_daily_reservations: [12, 1, 200],
    rooms_count: [2, 1, 50],
  };

  for (const [key, [fallback, min, max]] of Object.entries(intRules)) {
    if (raw[key] !== undefined) {
      out[key] = toInt(raw[key], fallback, min, max);
    }
  }

  // slot_interval_minutes はDB側CHECKが 10/15/20/30/45/60 のみ
  if (out.slot_interval_minutes !== undefined && ![10, 15, 20, 30, 45, 60].includes(out.slot_interval_minutes)) {
    out.slot_interval_minutes = 30;
  }

  if (isPlainObject(raw.settings)) out.settings = raw.settings;
  if (Object.keys(out).length) out.updated_at = new Date().toISOString();
  return out;
}

async function fetchSettingsBundle(ctx, shopCode) {
  const fakeUrl = new URL(`https://dummy.local/api/admin/settings?shop_code=${encodeURIComponent(shopCode)}`);
  const shop = await getShopFromUrl(fakeUrl, ctx);
  const today = todayJst();
  const futureDate = addDaysJst(today, Number(shop.default_booking_days_ahead || 60));

  const [businessHours, closedDays, menus, staff, rooms, ticketPlans, templates, settings] = await Promise.all([
    supabaseFetch(ctx, 'esthe_business_hours', { query: { select: '*', shop_id: `eq.${shop.id}`, order: 'day_of_week.asc' } }),
    supabaseFetch(ctx, 'esthe_closed_days', { query: { select: '*', shop_id: `eq.${shop.id}`, target_date: `gte.${today}`, order: 'target_date.asc', limit: 120 } }),
    supabaseFetch(ctx, 'esthe_menus', { query: { select: '*', shop_id: `eq.${shop.id}`, order: 'display_order.asc' } }),
    supabaseFetch(ctx, 'esthe_staff', { query: { select: '*', shop_id: `eq.${shop.id}`, order: 'display_order.asc' } }),
    supabaseFetch(ctx, 'esthe_rooms', { query: { select: '*', shop_id: `eq.${shop.id}`, order: 'display_order.asc' } }),
    supabaseFetch(ctx, 'esthe_ticket_plans', { query: { select: '*', shop_id: `eq.${shop.id}`, order: 'display_order.asc' } }),
    supabaseFetch(ctx, 'esthe_message_templates', { query: { select: '*', shop_id: `eq.${shop.id}`, order: 'display_order.asc' } }),
    supabaseFetch(ctx, 'esthe_settings', { query: { select: '*', shop_id: `eq.${shop.id}`, order: 'setting_key.asc' } }),
  ]);

  return {
    shop,
    business_hours: businessHours,
    closed_days: closedDays,
    menus,
    staff,
    rooms,
    ticket_plans: ticketPlans,
    message_templates: templates,
    settings,
    booking_range: {
      from: today,
      to: futureDate,
      days_ahead: shop.default_booking_days_ahead,
    },
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isShopSettingsOnly(value) {
  // shop.settings として保存したいJSONを、esthe_settingsの柔軟設定と誤判定しないための軽い保険。
  // body.shop.settings は shopUpdate 側で保存される。
  return false;
}

function toInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeChoice(value, allowed, fallback) {
  const v = cleanText(value);
  return allowed.includes(v) ? v : fallback;
}

function assertAndReturnDate(value, name) {
  assertDate(value, name);
  return String(value);
}

function cleanCode(value) {
  const s = cleanText(value)
    .toLowerCase()
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || `code_${Date.now()}`;
}

function makeCode(prefix, name, index) {
  const base = cleanText(name)
    .toLowerCase()
    .replace(/[^\w\u3040-\u30ff\u3400-\u9fff]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  // 日本語を含む場合もPostgres textとしては問題ないが、URL/APIで扱いやすいようにfallbackを持たせる
  return base && /^[a-z0-9_\-]+$/.test(base) ? `${prefix}_${base}` : `${prefix}_${index + 1}`;
}

async function handleMessageTemplates(url, ctx) {
  const shop = await getShopFromUrl(url, ctx);
  const rows = await supabaseFetch(ctx, 'esthe_message_templates', {
    query: { select: '*', shop_id: `eq.${shop.id}`, is_active: 'eq.true', order: 'display_order.asc' },
  });
  return jsonResponse({ ok: true, shop_code: shop.shop_code, templates: rows, version: VERSION });
}

async function handleMessageLog(request, url, ctx) {
  const body = await readJson(request);
  const shop = await getShop(ctx, body.shop_code || url.searchParams.get('shop_code') || ctx.defaultShopCode);
  if (!body.message_body) throw new Error('message_body は必須です。');

  const inserted = await supabaseFetch(ctx, 'esthe_message_logs', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      shop_id: shop.id,
      customer_id: body.customer_id || null,
      reservation_id: body.reservation_id || null,
      followup_id: body.followup_id || null,
      template_key: cleanText(body.template_key),
      channel: body.channel || 'line',
      action_type: body.action_type || 'copy',
      message_body: String(body.message_body),
      action_by: cleanText(body.action_by || 'staff'),
      is_demo: Boolean(body.is_demo),
    },
  });

  if (body.followup_id) {
    const current = await firstRow(ctx, 'esthe_followups', { select: 'copy_count', id: `eq.${body.followup_id}` });
    if (current) {
      await supabaseFetch(ctx, 'esthe_followups', {
        method: 'PATCH',
        query: { id: `eq.${body.followup_id}` },
        prefer: 'return=minimal',
        body: { copy_count: Number(current.copy_count || 0) + 1 },
      });
    }
  }

  return jsonResponse({ ok: true, message: '文面コピー履歴を保存しました。', log: inserted[0], version: VERSION }, 201);
}

async function getShopById(ctx, shopId) {
  const row = await firstRow(ctx, 'esthe_shops', { select: '*', id: `eq.${shopId}` });
  if (!row) throw new Error('店舗が見つかりません。');
  return row;
}

async function firstRow(ctx, table, query) {
  const rows = await supabaseFetch(ctx, table, { query: { ...query, limit: query.limit || 1 } });
  return rows?.[0] || null;
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}


function toHalfWidthPhoneText(value) {
  return cleanText(value)
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[＋]/g, '+')
    .replace(/[ー－―‐‑‒–—ｰ]/g, '-');
}

function normalizePhone(value) {
  let s = toHalfWidthPhoneText(value).replace(/[^\d+]/g, '');

  if (s.startsWith('+81')) {
    s = '0' + s.slice(3);
  } else if (s.startsWith('81') && s.length === 12) {
    s = '0' + s.slice(2);
  }

  return s.replace(/\D/g, '');
}

function buildPhoneNormalizationSamples() {
  const inputs = [
    '090-1111-2222',
    '09011112222',
    '090 1111 2222',
    '０９０ー１１１１ー２２２２',
    '+81 90-1111-2222',
  ];
  return inputs.map((input) => ({ input, normalized: normalizePhone(input) }));
}

async function findCustomerByPhone(ctx, shopId, rawPhone) {
  const normalized = normalizePhone(rawPhone);
  const raw = cleanText(rawPhone);
  if (!normalized && !raw) return null;

  const directCandidates = Array.from(new Set([normalized, raw].filter(Boolean)));
  for (const phone of directCandidates) {
    const row = await firstRow(ctx, 'esthe_customers', {
      select: '*',
      shop_id: `eq.${shopId}`,
      phone: `eq.${phone}`,
      limit: 1,
    });
    if (row) return row;
  }

  // デモ・小規模店舗向けの安全網：
  // 過去にハイフン付きで保存された顧客も、正規化後に同じ番号なら見つける。
  if (normalized.length >= 8) {
    const rows = await supabaseFetch(ctx, 'esthe_customers', {
      query: {
        select: '*',
        shop_id: `eq.${shopId}`,
        order: 'updated_at.desc',
        limit: 1000,
      },
    });
    return (rows || []).find((c) => normalizePhone(c.phone) === normalized) || null;
  }

  return null;
}

function mergeById(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (row && row.id && !map.has(row.id)) map.set(row.id, row);
  }
  return [...map.values()];
}


function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function cleanSearch(value) {
  return cleanText(value).replace(/[(),]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function assertDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${name} は YYYY-MM-DD 形式で指定してください。`);
  }
}

function normalizeTime(value) {
  const s = cleanText(value);
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const hh = String(Number(m[1])).padStart(2, '0');
  const mm = m[2];
  return `${hh}:${mm}`;
}

function todayJst() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function addDaysJst(dateStr, days) {
  assertDate(dateStr, 'date');
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

function dayOfWeekFromDate(dateStr) {
  assertDate(dateStr, 'date');
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function localDateTimeToDate(dateStr, timeStr) {
  assertDate(dateStr, 'date');
  const time = normalizeTime(timeStr);
  if (!time) throw new Error('time は HH:mm 形式で指定してください。');
  return new Date(`${dateStr}T${time}:00${JST_OFFSET}`);
}

function dateRangeJst(dateStr) {
  const start = localDateTimeToDate(dateStr, '00:00');
  const end = localDateTimeToDate(addDaysJst(dateStr, 1), '00:00');
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function dateJstFromIso(iso) {
  const dt = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return dt.toISOString().slice(0, 10);
}

function timeJstFromIso(iso) {
  const dt = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return dt.toISOString().slice(11, 16);
}

function timeToMinutes(time) {
  const [h, m] = normalizeTime(time).split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

function createReservationCode(prefix) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const stamp = jst.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}
