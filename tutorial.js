/* DPRO TUTORIAL STANDARD V1.1 / ESTHE R3
 * Exactly-10 contract. Tutorial-owned UI only. Business mutation = 0.
 */
(function () {
  'use strict';

  const VERSION = 'ESTHE-R3-V1.1-20260828';
  const TUTORIAL_ID = 'esthe-first10-v1.1';
  const SCHEMA_VERSION = '1.1.0';
  const STORAGE_KEY = 'dpro_tutorial_esthe_first10_v1_1';
  const TOTAL = 10;
  const EDGE = 8;
  const STEPS = Object.freeze([{"number":1,"id":"ESTHE-TUT-01","route":"demo-guide.html","routeUrl":"demo-guide.html","title":"公開デモの入口","body":"まず公開操作デモの入口で、エステ業務をどの順番で確認するかを把握します。公開デモでは実在する個人情報・肌や身体の情報を入力せず、架空データだけを使用します。","targets":["#heroTitle",".hero h1",".hero"],"nextRoute":null,"safety":["no product click","no data entry","no business mutation"]},{"number":2,"id":"ESTHE-TUT-02","route":"demo-guide.html","routeUrl":"demo-guide.html","title":"5画面の役割を確認","body":"予約、会員履歴、スタッフ、店舗iPad、オーナーPCの5画面が一つの接客・再来店フローにつながっています。次は予約画面へ進みます。","targets":["#screenGrid",".grid","main"],"nextRoute":"index-brush.html?v=esthe-next-10b","safety":["navigation only on Tutorial Next","do not activate product screen cards automatically","no business mutation"]},{"number":3,"id":"ESTHE-TUT-03","route":"index-brush.html","routeUrl":"index-brush.html?v=esthe-next-10b","title":"予約は5段階","body":"予約は会員確認、メニュー、日時、カウンセリング、確認の順です。Tutorialは流れを案内するだけで、予約送信や入力操作は自動実行しません。","targets":[".progress","#prog1","#viewMember"],"nextRoute":null,"safety":["never auto-click #nextBtn","never auto-click #submitBtn","no autofill","no reservation mutation"]},{"number":4,"id":"ESTHE-TUT-04","route":"index-brush.html","routeUrl":"index-brush.html?v=esthe-next-10b","title":"会員確認から開始","body":"最初の画面では電話番号や名前から会員確認できます。実際に試す場合も架空のデモ情報だけを使用してください。Tutorialは入力・照会・予約を自動実行しません。","targets":["#viewMember","#lookupPhone",".grid"],"nextRoute":"member.html","safety":["do not auto-click #lookupBtn","#skipLookupBtn remains product-owned","#submitBtn protected","no PII/health autofill"]},{"number":5,"id":"ESTHE-TUT-05","route":"member.html","routeUrl":"member.html","title":"会員マイページ","body":"会員ページでは電話番号を起点に次回予約、回数券、来店履歴を確認します。Tutorialは電話番号を入力せず、読み込みも自動実行しません。","targets":["#phoneInput","#loadBtn",".panel"],"nextRoute":null,"safety":["no phone autofill","do not auto-click #loadBtn","reservation change/cancel actions protected"]},{"number":6,"id":"ESTHE-TUT-06","route":"member.html","routeUrl":"member.html","title":"履歴・回数券の入口","body":"デモ顧客表示ボタンが用意されており、会員情報を確認する入口が分かります。Tutorialはボタンを押さず、履歴からの変更・キャンセル・再予約も自動実行しません。","targets":["#demoBtn","#loadBtn","#phoneInput"],"nextRoute":"staff.html","safety":["do not auto-click demo/load","do not mutate reservation","no business mutation"]},{"number":7,"id":"ESTHE-TUT-07","route":"staff.html","routeUrl":"staff.html","title":"管理コードはユーザー操作","body":"スタッフ画面の管理API利用には既存の管理コード入力欄があります。Tutorialは資格情報を推測・注入・保存せず、必要な場合はユーザー自身が製品画面で設定します。","targets":["#dproAdminAccess","#dproAdminCode",".toolbar"],"nextRoute":null,"safety":["never inject demo code","never auto-click #dproAdminSave or #dproAdminClear","no auth bypass","no status mutation"]},{"number":8,"id":"ESTHE-TUT-08","route":"staff.html","routeUrl":"staff.html","title":"スタッフの「今やること」","body":"スタッフ画面は担当予約と次の1操作を優先表示します。Tutorialは案内だけを行い、施術開始やステータス変更など業務状態を変える操作は自動実行しません。","targets":["#fieldCommandCenter","#fieldNowMain",".stats"],"nextRoute":"owner-ipad.html","safety":["no treatment/status transition","no product button auto-click","no business mutation"]},{"number":9,"id":"ESTHE-TUT-09","route":"owner-ipad.html","routeUrl":"owner-ipad.html","title":"店舗iPadで施術進捗","body":"店舗iPadは本日の施術進捗を中心に、来店から完了までを確認する画面です。Tutorialはボードを指し示すだけで、来店・施術・会計・完了への状態更新やデモ準備は行いません。","targets":["#progressBoardTitle","#progressBoard","#tabToday"],"nextRoute":"owner.html","safety":["never auto-click status controls","never auto-run #prepareBtn","no note/ticket mutation","no business mutation"]},{"number":10,"id":"ESTHE-TUT-10","route":"owner.html","routeUrl":"owner.html","title":"オーナーPCで再来店フォロー","body":"オーナーPCでは今日の状況に加え、顧客・回数券・再来店フォローへつながります。再来店フォローは個別確認が前提です。Tutorialはタブを案内するだけで、送信・対応済み・回数券使用・カルテ保存などを自動実行しません。","targets":["[data-tab=\"followups\"]",".tabs","#progressBoardTitle"],"nextRoute":null,"safety":["do not auto-click product tab/action","no LINE send","no mark-handled","no ticket use","no note/settings/demo-prepare mutation"]}]);

  let state = loadState();
  let root = null;
  let launcher = null;
  let card = null;
  let highlight = null;
  let targetElement = null;
  let dragging = null;
  let lastResolvedSelector = '';
  let targetStatus = 'unresolved';
  const diagnostics = [];

  function defaultState() {
    return {
      tutorialId:TUTORIAL_ID,
      schemaVersion:SCHEMA_VERSION,
      status:'not_started',
      currentStep:1,
      completedSteps:[],
      cardPosition:{x:.5,y:.12},
      startedAt:null,
      updatedAt:new Date().toISOString(),
      completedAt:null
    };
  }

  function safeParse(value) {
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function loadState() {
    const parsed = safeParse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || parsed.tutorialId !== TUTORIAL_ID || parsed.schemaVersion !== SCHEMA_VERSION) return defaultState();
    parsed.currentStep = clampStep(parsed.currentStep);
    parsed.completedSteps = Array.isArray(parsed.completedSteps)
      ? [...new Set(parsed.completedSteps.filter(n => Number.isInteger(n) && n >= 1 && n <= TOTAL))]
      : [];
    if (!parsed.cardPosition || !Number.isFinite(Number(parsed.cardPosition.x)) || !Number.isFinite(Number(parsed.cardPosition.y))) {
      parsed.cardPosition = {x:.5,y:.12};
    }
    return parsed;
  }

  function saveState() {
    state.currentStep = clampStep(state.currentStep);
    state.updatedAt = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    expose();
  }

  function clampStep(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(1, Math.min(TOTAL, Math.round(n))) : 1;
  }

  function routeName() {
    return location.pathname.split('/').pop() || 'demo-guide.html';
  }

  function currentStep() {
    return STEPS[state.currentStep - 1];
  }

  function routeMatches(step) {
    return routeName() === step.route;
  }

  function tutorialUrl(relative) {
    const url = new URL(relative, location.href);
    url.searchParams.set('dpro_tutorial','1');
    return url.href;
  }

  function routeForStep(number) {
    const step = STEPS[clampStep(number)-1];
    return tutorialUrl(step.routeUrl || step.route);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  function resolveTarget(step) {
    targetElement = null;
    lastResolvedSelector = '';
    for (const selector of step.targets) {
      let el = null;
      try { el = document.querySelector(selector); } catch (_) {}
      if (visible(el)) {
        targetElement = el;
        lastResolvedSelector = selector;
        targetStatus = 'resolved';
        return el;
      }
    }
    targetStatus = 'fallback_unavailable';
    return null;
  }

  function mount() {
    if (document.getElementById('dproTutorialRoot')) return;
    root = document.createElement('div');
    root.id = 'dproTutorialRoot';
    root.innerHTML = `
      <button id="dproTutorialLauncher" type="button" aria-label="DPRO Tutorialを開始"></button>
      <div id="dproTutorialHighlight" hidden aria-hidden="true"></div>
      <section id="dproTutorialCard" role="dialog" aria-modal="false" aria-labelledby="dproTutorialTitle" aria-describedby="dproTutorialDescription" tabindex="-1" hidden>
        <div class="dpro-tutorial-header">
          <div class="dpro-tutorial-handle" id="dproTutorialHandle" role="button" tabindex="0" aria-label="ガイドカードを移動">
            <span aria-hidden="true">⠿</span><span>ガイドを移動</span>
          </div>
          <button class="dpro-tutorial-close" id="dproTutorialClose" type="button" aria-label="ガイドを閉じる">閉じる</button>
        </div>
        <div class="dpro-tutorial-body">
          <div class="dpro-tutorial-progress-row">
            <span id="dproTutorialProgress">1 / 10</span>
            <span class="dpro-tutorial-progress-bar" aria-hidden="true"><span id="dproTutorialProgressFill"></span></span>
          </div>
          <h2 id="dproTutorialTitle"></h2>
          <p id="dproTutorialDescription"></p>
          <div id="dproTutorialSafety"></div>
          <div id="dproTutorialTargetStatus" role="status" aria-live="polite"></div>
          <div class="dpro-tutorial-actions">
            <button class="dpro-tutorial-button" id="dproTutorialBack" type="button">戻る</button>
            <button class="dpro-tutorial-button" id="dproTutorialSkip" type="button">スキップ</button>
            <button class="dpro-tutorial-button primary" id="dproTutorialNext" type="button">次へ</button>
          </div>
          <div class="dpro-tutorial-secondary-actions">
            <button class="dpro-tutorial-button quiet" id="dproTutorialResetPosition" type="button">位置を戻す</button>
            <span>Escで一時停止</span>
          </div>
        </div>
      </section>`;
    document.body.appendChild(root);
    launcher = document.getElementById('dproTutorialLauncher');
    card = document.getElementById('dproTutorialCard');
    highlight = document.getElementById('dproTutorialHighlight');
    bind();
    updateLauncher();
    if (state.status === 'in_progress') {
      if (routeMatches(currentStep())) renderStep();
      else location.replace(routeForStep(state.currentStep));
    }
    expose();
  }

  function bind() {
    launcher.addEventListener('click', launch);
    document.getElementById('dproTutorialClose').addEventListener('click', pause);
    document.getElementById('dproTutorialBack').addEventListener('click', back);
    document.getElementById('dproTutorialSkip').addEventListener('click', skip);
    document.getElementById('dproTutorialNext').addEventListener('click', next);
    document.getElementById('dproTutorialResetPosition').addEventListener('click', resetPosition);

    const handle = document.getElementById('dproTutorialHandle');
    handle.addEventListener('pointerdown', pointerDown);
    handle.addEventListener('pointermove', pointerMove);
    handle.addEventListener('pointerup', pointerUp);
    handle.addEventListener('pointercancel', pointerUp);
    handle.addEventListener('keydown', handleKey);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && card && !card.hidden) {
        event.preventDefault();
        pause();
      }
    });

    addEventListener('resize', refreshGeometry, {passive:true});
    addEventListener('scroll', refreshHighlight, {passive:true,capture:true});
    if (visualViewport) {
      visualViewport.addEventListener('resize', refreshGeometry, {passive:true});
      visualViewport.addEventListener('scroll', refreshGeometry, {passive:true});
    }
  }

  function launch() {
    if (state.status === 'completed' || state.status === 'skipped') {
      replay();
      return;
    }
    if (state.status === 'not_started') {
      state.currentStep = 1;
      state.completedSteps = [];
      state.startedAt = new Date().toISOString();
    }
    state.status = 'in_progress';
    saveState();
    if (routeMatches(currentStep())) renderStep();
    else location.href = routeForStep(state.currentStep);
  }

  function replay() {
    state = defaultState();
    state.status = 'in_progress';
    state.startedAt = new Date().toISOString();
    saveState();
    location.href = routeForStep(1);
  }

  function pause() {
    if (!card || card.hidden) return;
    state.status = 'paused';
    saveState();
    hideCard();
    updateLauncher();
    launcher.focus({preventScroll:true});
    log('pause', {focusRecovered:document.activeElement === launcher});
  }

  function skip() {
    state.status = 'skipped';
    saveState();
    hideCard();
    updateLauncher();
    launcher.focus({preventScroll:true});
    log('skip', {});
  }

  function back() {
    if (state.currentStep <= 1) return;
    state.currentStep -= 1;
    state.status = 'in_progress';
    saveState();
    navigateToCurrent();
  }

  function next() {
    const n = state.currentStep;
    if (!state.completedSteps.includes(n)) state.completedSteps.push(n);
    if (n >= TOTAL) {
      state.status = 'completed';
      state.completedAt = new Date().toISOString();
      saveState();
      hideCard();
      updateLauncher();
      launcher.focus({preventScroll:true});
      log('complete', {completedSteps:state.completedSteps.length});
      return;
    }
    state.currentStep = n + 1;
    state.status = 'in_progress';
    saveState();
    navigateToCurrent();
  }

  function navigateToCurrent() {
    const step = currentStep();
    if (routeMatches(step)) renderStep();
    else location.href = routeForStep(state.currentStep);
  }

  function hideCard() {
    if (card) card.hidden = true;
    if (highlight) highlight.hidden = true;
    targetElement = null;
  }

  function updateLauncher() {
    if (!launcher) return;
    const map = {
      not_started:'チュートリアルを開始',
      in_progress:'チュートリアルを再開',
      paused:'チュートリアルを再開',
      completed:'もう一度見る',
      skipped:'もう一度見る'
    };
    launcher.textContent = map[state.status] || 'チュートリアルを開始';
    launcher.setAttribute('data-state', state.status);
    launcher.setAttribute('aria-label', launcher.textContent);
  }

  function renderStep() {
    const step = currentStep();
    card.hidden = false;
    updateLauncher();
    document.getElementById('dproTutorialProgress').textContent = `${step.number} / ${TOTAL}`;
    document.getElementById('dproTutorialProgressFill').style.width = `${step.number / TOTAL * 100}%`;
    document.getElementById('dproTutorialTitle').textContent = step.title;
    document.getElementById('dproTutorialDescription').textContent = step.body;
    document.getElementById('dproTutorialSafety').textContent = 'Tutorialは案内のみ：業務ボタンの自動操作・資格情報入力・業務データ更新は行いません。';
    document.getElementById('dproTutorialBack').disabled = step.number === 1;
    document.getElementById('dproTutorialNext').textContent = step.number === TOTAL ? '完了' : '次へ';
    applyCardPosition();

    const target = resolveTarget(step);
    const status = document.getElementById('dproTutorialTargetStatus');
    if (target) {
      status.textContent = `対象を表示中：${lastResolvedSelector}`;
      try { target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}); } catch (_) {
        try { target.scrollIntoView({block:'center',inline:'nearest'}); } catch (_) {}
      }
      refreshHighlight();
    } else {
      status.textContent = '対象が現在表示されていないため、安全なフォールバックで案内を継続します。';
      highlight.hidden = true;
    }
    requestAnimationFrame(() => {
      refreshGeometry();
      const nextButton = document.getElementById('dproTutorialNext');
      nextButton.focus({preventScroll:true});
      log('render', {
        selector:lastResolvedSelector || null,
        targetFound:Boolean(target),
        focusVisible:document.activeElement === nextButton
      });
    });
    expose();
  }

  function refreshHighlight() {
    if (!highlight || card.hidden || !targetElement || !visible(targetElement)) {
      if (highlight) highlight.hidden = true;
      return;
    }
    const r = targetElement.getBoundingClientRect();
    const pad = 5;
    const left = Math.max(2, r.left - pad);
    const top = Math.max(2, r.top - pad);
    const right = Math.min(innerWidth - 2, r.right + pad);
    const bottom = Math.min(innerHeight - 2, r.bottom + pad);
    highlight.style.left = `${left}px`;
    highlight.style.top = `${top}px`;
    highlight.style.width = `${Math.max(0,right-left)}px`;
    highlight.style.height = `${Math.max(0,bottom-top)}px`;
    highlight.hidden = false;
  }

  function cardBounds() {
    const vv = visualViewport;
    const vw = vv ? vv.width : innerWidth;
    const vh = vv ? vv.height : innerHeight;
    const ox = vv ? vv.offsetLeft : 0;
    const oy = vv ? vv.offsetTop : 0;
    const rect = card.getBoundingClientRect();
    return {
      minX:ox + EDGE,
      maxX:Math.max(ox + EDGE, ox + vw - rect.width - EDGE),
      minY:oy + EDGE,
      maxY:Math.max(oy + EDGE, oy + vh - rect.height - EDGE),
      vw,vh,ox,oy
    };
  }

  function clampCard(left, top) {
    const b = cardBounds();
    return {
      left:Math.min(b.maxX, Math.max(b.minX, left)),
      top:Math.min(b.maxY, Math.max(b.minY, top))
    };
  }

  function normalizedFromPixels(left, top) {
    const b = cardBounds();
    const xRange = Math.max(1,b.maxX-b.minX);
    const yRange = Math.max(1,b.maxY-b.minY);
    return {
      x:(left-b.minX)/xRange,
      y:(top-b.minY)/yRange
    };
  }

  function pixelsFromNormalized(pos) {
    const b = cardBounds();
    return {
      left:b.minX + Math.max(0,Math.min(1,Number(pos.x))) * Math.max(0,b.maxX-b.minX),
      top:b.minY + Math.max(0,Math.min(1,Number(pos.y))) * Math.max(0,b.maxY-b.minY)
    };
  }

  function applyCardPosition() {
    if (!card || card.hidden) return;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
    const p = pixelsFromNormalized(state.cardPosition || {x:.5,y:.12});
    const c = clampCard(p.left,p.top);
    card.style.left = `${c.left}px`;
    card.style.top = `${c.top}px`;
  }

  function refreshGeometry() {
    if (!card || card.hidden) return;
    applyCardPosition();
    refreshHighlight();
  }

  function pointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = card.getBoundingClientRect();
    dragging = {
      pointerId:event.pointerId,
      dx:event.clientX-rect.left,
      dy:event.clientY-rect.top
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
    log('drag_start', {pointerType:event.pointerType || 'unknown'});
  }

  function pointerMove(event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const c = clampCard(event.clientX-dragging.dx,event.clientY-dragging.dy);
    card.style.left = `${c.left}px`;
    card.style.top = `${c.top}px`;
    state.cardPosition = normalizedFromPixels(c.left,c.top);
    refreshHighlight();
    event.preventDefault();
  }

  function pointerUp(event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) {}
    dragging = null;
    saveState();
    log('drag_end', {pointerType:event.pointerType || 'unknown',rect:card.getBoundingClientRect().toJSON ? card.getBoundingClientRect().toJSON() : null});
  }

  function handleKey(event) {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') {
      resetPosition();
      return;
    }
    const rect = card.getBoundingClientRect();
    const step = event.shiftKey ? 1 : 10;
    let left=rect.left, top=rect.top;
    if (event.key === 'ArrowLeft') left -= step;
    if (event.key === 'ArrowRight') left += step;
    if (event.key === 'ArrowUp') top -= step;
    if (event.key === 'ArrowDown') top += step;
    const c = clampCard(left,top);
    card.style.left = `${c.left}px`;
    card.style.top = `${c.top}px`;
    state.cardPosition = normalizedFromPixels(c.left,c.top);
    saveState();
    refreshHighlight();
  }

  function resetPosition() {
    state.cardPosition = {x:.5,y:.12};
    saveState();
    applyCardPosition();
    refreshHighlight();
    document.getElementById('dproTutorialHandle').focus({preventScroll:true});
    log('reset_position', {});
  }

  function log(type, detail) {
    diagnostics.push({at:new Date().toISOString(),type,step:state.currentStep,route:routeName(),...detail});
    if (diagnostics.length > 200) diagnostics.shift();
    expose();
  }

  function expose() {
    window.__DPRO_TUTORIAL__ = {
      version:VERSION,
      tutorialId:TUTORIAL_ID,
      total:TOTAL,
      steps:STEPS.map(step => ({...step,targets:[...step.targets],safety:[...step.safety]})),
      state:JSON.parse(JSON.stringify(state)),
      currentRoute:routeName(),
      target:{status:targetStatus,selector:lastResolvedSelector,found:Boolean(targetElement)},
      diagnostics:[...diagnostics],
      start:launch,
      pause,
      resume:launch,
      replay,
      skip,
      next,
      back,
      resetPosition,
      storageKey:STORAGE_KEY
    };
  }

  // Mark Tutorial-originated requests. No business writes are ever issued here.
  window.__DPRO_TUTORIAL_NETWORK_POLICY__ = Object.freeze({
    allowedMethods:['GET','HEAD','OPTIONS'],
    businessMutation:0,
    autoProductClick:false,
    autoCredentialInjection:false
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
