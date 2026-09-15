'use strict';

const API = '/manage/api';
const PAGE_SIZE = 20;

const state = {
  token: localStorage.getItem('dcd_token') || '',
  pools: [],
  cards: [],
  userPage: 1,
  userTotal: 0,
  userKeyword: '',
  recordPage: 1,
  recordTotal: 0,
  modalSubmit: null,
};

const $ = (id) => document.getElementById(id);

function showMessage(text, type = 'success') {
  const box = $('msg');
  box.textContent = text;
  box.className = `msg show ${type}`;
  if (type === 'success') {
    setTimeout(() => box.classList.remove('show'), 4000);
  }
}

function showModalMessage(text) {
  const box = $('modalMsg');
  box.textContent = text;
  box.className = 'msg show error';
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401) {
    logout();
    throw new Error('登录已过期，请重新登录。');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）`);
  }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `请求失败（HTTP ${response.status}）`);
  }
  return payload.data;
}

function rarityBadge(rarity) {
  const value = String(rarity || '?').toUpperCase();
  return `<span class="rarity ${value}">${value}</span>`;
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function yesNo(value) {
  return value ? '<span style="color: var(--ok)">是</span>' : '<span class="muted">否</span>';
}

/* ---------------- 登录 ---------------- */

function logout() {
  state.token = '';
  localStorage.removeItem('dcd_token');
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}

async function login() {
  const box = $('loginMsg');
  try {
    const data = await api('/login', {
      method: 'POST',
      body: { username: $('loginUser').value.trim(), password: $('loginPass').value },
    });
    state.token = data.token;
    localStorage.setItem('dcd_token', data.token);
    box.className = 'msg';
    await enterApp();
  } catch (error) {
    box.textContent = error.message;
    box.className = 'msg show error';
  }
}

async function enterApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  const me = await api('/me');
  $('whoami').textContent = `当前账号：${me.username}`;
  await refreshPools();
  await switchTab(currentTab);
}

/* ---------------- 标签页 ---------------- */

let currentTab = 'overview';

async function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  ['overview', 'pools', 'cards', 'users', 'records'].forEach((name) => {
    $(`tab-${name}`).classList.toggle('hidden', name !== tab);
  });

  try {
    if (tab === 'overview') await loadOverview();
    if (tab === 'pools') await loadPools();
    if (tab === 'cards') await loadCards();
    if (tab === 'users') await loadUsers();
    if (tab === 'records') await loadRecords();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

/* ---------------- 概览 ---------------- */

async function loadOverview() {
  const data = await api('/overview');
  const items = [
    ['总抽卡记录', data.total_records],
    ['累计积分', data.total_score],
    ['参与用户数', data.total_users],
    ['今日记录', data.today_records],
    ['今日参与人数', data.today_users],
    ['卡池数', `${data.enabled_pool_count} / ${data.pool_count}`],
  ];
  $('overviewGrid').innerHTML = items
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`,
    )
    .join('');
  showMessage(`统计日期：${data.quota_date}`, 'success');
}

/* ---------------- 卡池 ---------------- */

async function refreshPools() {
  const data = await api('/pools');
  state.pools = data.list || [];
  const select = $('recordPool');
  select.innerHTML = '<option value="">全部卡池</option>';
  state.pools.forEach((pool) => {
    const option = document.createElement('option');
    option.value = pool.id;
    option.textContent = `${pool.pool_name}（${pool.pool_key}）`;
    select.appendChild(option);
  });
}

async function loadPools() {
  await refreshPools();
  $('poolsBody').innerHTML = state.pools
    .map(
      (pool) => `<tr>
        <td>${pool.id}</td>
        <td>${escapeHtml(pool.pool_key)}</td>
        <td>${escapeHtml(pool.pool_name)}</td>
        <td>${yesNo(pool.is_enabled)}</td>
        <td>${yesNo(pool.allow_single_draw)}</td>
        <td>${yesNo(pool.allow_ten_draw)}</td>
        <td>${pool.daily_single_quota}</td>
        <td>${pool.daily_ten_draw_quota}</td>
        <td class="muted">${escapeHtml(pool.start_at || '-')} ~ ${escapeHtml(pool.end_at || '-')}</td>
        <td>
          <button class="ghost small" data-action="edit-pool" data-id="${pool.id}">编辑</button>
          <button class="ghost small" data-action="pool-cards" data-id="${pool.id}">卡池配置</button>
          <button class="danger small" data-action="delete-pool" data-id="${pool.id}">删除</button>
        </td>
      </tr>`,
    )
    .join('');
}

function poolFormHtml(pool = {}) {
  return `
    <div class="field" style="margin-bottom: 12px">
      <label>pool_key（字母数字下划线短横线）</label>
      <input id="f_pool_key" value="${escapeHtml(pool.pool_key || '')}" />
    </div>
    <div class="field" style="margin-bottom: 12px">
      <label>卡池名称</label>
      <input id="f_pool_name" value="${escapeHtml(pool.pool_name || '')}" />
    </div>
    <div class="field" style="margin-bottom: 12px">
      <label>描述</label>
      <input id="f_description" value="${escapeHtml(pool.description || '')}" />
    </div>
    <div class="row" style="margin-bottom: 12px">
      <div class="field">
        <label>每日单抽次数</label>
        <input id="f_daily_single_quota" type="number" min="0" value="${pool.daily_single_quota ?? 1}" />
      </div>
      <div class="field">
        <label>每日十连次数</label>
        <input id="f_daily_ten_draw_quota" type="number" min="0" value="${pool.daily_ten_draw_quota ?? 1}" />
      </div>
    </div>
    <div class="row" style="margin-bottom: 12px">
      <div class="field">
        <label>开始时间（留空为不限）</label>
        <input id="f_start_at" placeholder="2026-01-01 00:00:00" value="${escapeHtml(pool.start_at || '')}" />
      </div>
      <div class="field">
        <label>结束时间（留空为不限）</label>
        <input id="f_end_at" placeholder="2026-12-31 23:59:59" value="${escapeHtml(pool.end_at || '')}" />
      </div>
    </div>
    <div class="row">
      <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
        <input type="checkbox" id="f_is_enabled" ${pool.is_enabled === false ? '' : 'checked'} /> 启用卡池
      </label>
      <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
        <input type="checkbox" id="f_allow_single_draw" ${pool.allow_single_draw === false ? '' : 'checked'} /> 允许单抽
      </label>
      <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
        <input type="checkbox" id="f_allow_ten_draw" ${pool.allow_ten_draw === false ? '' : 'checked'} /> 允许十连
      </label>
    </div>
  `;
}

function readPoolForm() {
  return {
    pool_key: $('f_pool_key').value.trim(),
    pool_name: $('f_pool_name').value.trim(),
    description: $('f_description').value.trim(),
    daily_single_quota: Number.parseInt($('f_daily_single_quota').value, 10) || 0,
    daily_ten_draw_quota: Number.parseInt($('f_daily_ten_draw_quota').value, 10) || 0,
    start_at: $('f_start_at').value.trim(),
    end_at: $('f_end_at').value.trim(),
    is_enabled: $('f_is_enabled').checked,
    allow_single_draw: $('f_allow_single_draw').checked,
    allow_ten_draw: $('f_allow_ten_draw').checked,
  };
}

function openPoolModal(pool) {
  openModal(pool ? `编辑卡池 #${pool.id}` : '新建卡池', poolFormHtml(pool || {}), async () => {
    const payload = readPoolForm();
    if (!payload.pool_key || !payload.pool_name) {
      showModalMessage('pool_key 与卡池名称都不能为空。');
      return;
    }
    if (pool) {
      await api(`/pools/${pool.id}`, { method: 'PUT', body: payload });
    } else {
      await api('/pools', { method: 'POST', body: payload });
    }
    closeModal();
    await switchTab('pools');
    showMessage('卡池已保存。', 'success');
  });
}

async function openPoolCardsModal(pool) {
  const data = await api(`/pools/${pool.id}/cards`);
  const cards = await api('/cards');
  const configured = new Map((data.list || []).map((item) => [item.card_id, item]));

  const rows = (cards.list || [])
    .map((card) => {
      const current = configured.get(card.id);
      return `<tr>
        <td>${escapeHtml(card.card_name)}</td>
        <td>${rarityBadge(card.rarity)}</td>
        <td>${card.score_value}</td>
        <td><input type="number" min="0" data-card-weight="${card.id}" value="${current ? current.weight : 0}" style="width: 90px" /></td>
        <td><input type="checkbox" data-card-up="${card.id}" ${current && current.is_up ? 'checked' : ''} /></td>
        <td class="muted">${current ? (current.rate * 100).toFixed(2) + '%' : '未加入'}</td>
      </tr>`;
    })
    .join('');

  const body = `
    <p class="hint">权重为 0 表示该卡不参与本卡池抽取。保存后立刻生效。</p>
    <div class="table-scroll">
      <table>
        <thead><tr><th>卡牌</th><th>稀有度</th><th>积分</th><th>权重</th><th>UP</th><th>当前概率</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">还没有卡牌，请先在「卡牌」里创建。</td></tr>'}</tbody>
      </table>
    </div>
  `;

  openModal(`卡池配置 · ${pool.pool_name}`, body, async () => {
    const items = [];
    document.querySelectorAll('[data-card-weight]').forEach((input) => {
      const cardId = Number.parseInt(input.dataset.cardWeight, 10);
      const weight = Number.parseInt(input.value, 10) || 0;
      const upBox = document.querySelector(`[data-card-up="${cardId}"]`);
      if (weight > 0) {
        items.push({ card_id: cardId, weight, is_up: Boolean(upBox && upBox.checked) });
      }
    });
    await api(`/pools/${pool.id}/cards`, { method: 'PUT', body: { items } });
    closeModal();
    showMessage(`卡池配置已保存（${items.length} 张卡参与抽取）。`, 'success');
  });
}

/* ---------------- 卡牌 ---------------- */

async function loadCards() {
  const keyword = $('cardKeyword').value.trim();
  const data = await api(`/cards${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`);
  state.cards = data.list || [];
  $('cardsBody').innerHTML = state.cards
    .map(
      (card) => `<tr>
        <td>${card.id}</td>
        <td>${escapeHtml(card.card_key)}</td>
        <td>${escapeHtml(card.card_name)}</td>
        <td>${rarityBadge(card.rarity)}</td>
        <td>${card.score_value}</td>
        <td>${yesNo(card.is_enabled)}</td>
        <td>
          <button class="ghost small" data-action="edit-card" data-id="${card.id}">编辑</button>
          <button class="danger small" data-action="delete-card" data-id="${card.id}">删除</button>
        </td>
      </tr>`,
    )
    .join('');
}

function cardFormHtml(card = {}) {
  return `
    <div class="row" style="margin-bottom: 12px">
      <div class="field">
        <label>card_key</label>
        <input id="c_card_key" value="${escapeHtml(card.card_key || '')}" />
      </div>
      <div class="field">
        <label>卡牌名称</label>
        <input id="c_card_name" value="${escapeHtml(card.card_name || '')}" />
      </div>
    </div>
    <div class="row" style="margin-bottom: 12px">
      <div class="field">
        <label>稀有度</label>
        <select id="c_rarity">
          ${['N', 'R', 'SR', 'SSR', 'UR']
            .map(
              (rarity) =>
                `<option value="${rarity}" ${String(card.rarity || 'N').toUpperCase() === rarity ? 'selected' : ''}>${rarity}</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="field">
        <label>积分</label>
        <input id="c_score_value" type="number" value="${card.score_value ?? 0}" />
      </div>
      <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
        <input type="checkbox" id="c_is_enabled" ${card.is_enabled === false ? '' : 'checked'} /> 启用
      </label>
    </div>
    <div class="field">
      <label>描述</label>
      <input id="c_description" value="${escapeHtml(card.description || '')}" />
    </div>
  `;
}

function openCardModal(card) {
  openModal(card ? `编辑卡牌 #${card.id}` : '新建卡牌', cardFormHtml(card || {}), async () => {
    const payload = {
      card_key: $('c_card_key').value.trim(),
      card_name: $('c_card_name').value.trim(),
      rarity: $('c_rarity').value,
      score_value: Number.parseInt($('c_score_value').value, 10) || 0,
      is_enabled: $('c_is_enabled').checked,
      description: $('c_description').value.trim(),
    };
    if (!payload.card_key || !payload.card_name) {
      showModalMessage('card_key 与卡牌名称都不能为空。');
      return;
    }
    if (card) {
      await api(`/cards/${card.id}`, { method: 'PUT', body: payload });
    } else {
      await api('/cards', { method: 'POST', body: payload });
    }
    closeModal();
    await switchTab('cards');
    showMessage('卡牌已保存。', 'success');
  });
}

/* ---------------- 用户 ---------------- */

async function loadUsers(page = state.userPage) {
  state.userPage = page;
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
  });
  if (state.userKeyword) {
    query.set('keyword', state.userKeyword);
  }
  const data = await api(`/users?${query.toString()}`);
  state.userTotal = data.total;

  $('usersBody').innerHTML = (data.rows || []).length
    ? data.rows
        .map(
          (user) => `<tr>
            <td>${escapeHtml(user.qq_id)}</td>
            <td>${escapeHtml(user.nickname || '-')}</td>
            <td>${user.total_draw_count}</td>
            <td>${user.total_single_draw_count}</td>
            <td>${user.total_ten_draw_count}</td>
            <td>${user.total_score}</td>
            <td>${user.total_ssr_count}</td>
            <td>${user.total_ur_count}</td>
            <td class="muted">${escapeHtml(user.updated_at || '')}</td>
            <td>
              <button class="ghost small" data-action="view-user-records" data-qq="${escapeHtml(user.qq_id)}">记录</button>
              <button class="ghost small" data-action="reset-user" data-qq="${escapeHtml(user.qq_id)}">重置次数</button>
            </td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="10" class="muted">暂无用户数据。</td></tr>';

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  $('userPageInfo').textContent = `第 ${page} / ${totalPages} 页 · 共 ${data.total} 人`;
  $('userPrev').disabled = page <= 1;
  $('userNext').disabled = page >= totalPages;
}

async function openUserRecordsModal(qqId) {
  const data = await api(`/users/${encodeURIComponent(qqId)}/records?page=1&page_size=50`);
  const rows = (data.list || [])
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.created_at || '')}</td>
        <td>${escapeHtml(item.pool_name || '')}</td>
        <td>${item.draw_mode === 'ten' ? '十连' : '单抽'}</td>
        <td>${item.total_score}</td>
        <td>${rarityBadge(item.highest_rarity || '?')}</td>
      </tr>`,
    )
    .join('');
  openModal(
    `抽卡记录 · ${qqId}（最近 ${data.list.length} / ${data.total} 条）`,
    `<div class="table-scroll"><table>
       <thead><tr><th>时间</th><th>卡池</th><th>模式</th><th>积分</th><th>最高稀有度</th></tr></thead>
       <tbody>${rows || '<tr><td colspan="5" class="muted">暂无记录。</td></tr>'}</tbody>
     </table></div>`,
    null,
  );
}

async function openResetModal(qqId) {
  const options = state.pools
    .map((pool) => `<option value="${pool.id}">${escapeHtml(pool.pool_name)}（${escapeHtml(pool.pool_key)}）</option>`)
    .join('');
  openModal(
    `重置每日次数 · ${qqId}`,
    `<div class="field"><label>选择卡池</label><select id="r_pool">${options}</select></div>
     <p class="hint">只会把该 QQ 今天在该卡池的已用次数清零，历史记录不受影响。</p>`,
    async () => {
      const poolId = Number.parseInt($('r_pool').value, 10);
      await api(`/users/${encodeURIComponent(qqId)}/reset-quota`, {
        method: 'POST',
        body: { pool_id: poolId },
      });
      closeModal();
      showMessage(`已重置 ${qqId} 的当日次数。`, 'success');
      await loadUsers();
    },
  );
}

/* ---------------- 流水 ---------------- */

async function loadRecords(page = state.recordPage) {
  state.recordPage = page;
  const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  const qq = $('recordQq').value.trim();
  const poolId = $('recordPool').value;
  if (qq) {
    query.set('qq_id', qq);
  }
  if (poolId) {
    query.set('pool_id', poolId);
  }

  const data = await api(`/records?${query.toString()}`);
  state.recordTotal = data.total;

  $('recordsBody').innerHTML = (data.rows || []).length
    ? data.rows
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.created_at || '')}</td>
            <td>${escapeHtml(row.qq_id)}</td>
            <td>${escapeHtml(row.pool_name || '')}</td>
            <td>${row.draw_mode === 'ten' ? '十连' : '单抽'}</td>
            <td>${row.total_score}</td>
            <td>${rarityBadge(row.highest_rarity || '?')}</td>
            <td class="muted">${escapeHtml(row.record_no)}</td>
            <td>${(row.cards || [])
              .map((card) => `<span class="chip">${rarityBadge(card.rarity)} ${escapeHtml(card.card_name)}</span>`)
              .join(' ')}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="8" class="muted">暂无流水。</td></tr>';

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  $('recordPageInfo').textContent = `第 ${page} / ${totalPages} 页 · 共 ${data.total} 条`;
  $('recordPrev').disabled = page <= 1;
  $('recordNext').disabled = page >= totalPages;
}

/* ---------------- 弹窗 ---------------- */

function openModal(title, bodyHtml, onSubmit) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  $('modalMsg').className = 'msg';
  state.modalSubmit = onSubmit;
  $('modalSubmit').classList.toggle('hidden', !onSubmit);
  $('modal').classList.add('show');
}

function closeModal() {
  $('modal').classList.remove('show');
  state.modalSubmit = null;
}

/* ---------------- 事件绑定 ---------------- */

document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

$('loginBtn').addEventListener('click', login);
$('loginPass').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    login();
  }
});
$('logoutBtn').addEventListener('click', logout);

$('newPoolBtn').addEventListener('click', () => openPoolModal(null));
$('newCardBtn').addEventListener('click', () => openCardModal(null));
$('cardSearchBtn').addEventListener('click', () => switchTab('cards'));
$('recordSearchBtn').addEventListener('click', () => loadRecords(1).catch((error) => showMessage(error.message, 'error')));
$('userSearchBtn').addEventListener('click', () => {
  state.userKeyword = $('userKeyword').value.trim();
  loadUsers(1).catch((error) => showMessage(error.message, 'error'));
});
$('userPrev').addEventListener('click', () => loadUsers(state.userPage - 1).catch((error) => showMessage(error.message, 'error')));
$('userNext').addEventListener('click', () => loadUsers(state.userPage + 1).catch((error) => showMessage(error.message, 'error')));
$('recordPrev').addEventListener('click', () => loadRecords(state.recordPage - 1).catch((error) => showMessage(error.message, 'error')));
$('recordNext').addEventListener('click', () => loadRecords(state.recordPage + 1).catch((error) => showMessage(error.message, 'error')));

$('modalClose').addEventListener('click', closeModal);
$('modalCancel').addEventListener('click', closeModal);
$('modalSubmit').addEventListener('click', async () => {
  if (!state.modalSubmit) {
    return;
  }
  $('modalSubmit').disabled = true;
  try {
    await state.modalSubmit();
  } catch (error) {
    showModalMessage(error.message);
  } finally {
    $('modalSubmit').disabled = false;
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }
  const { action } = button.dataset;
  const id = Number.parseInt(button.dataset.id, 10);
  const qq = button.dataset.qq;

  try {
    if (action === 'edit-pool') {
      openPoolModal(state.pools.find((pool) => pool.id === id));
    } else if (action === 'pool-cards') {
      await openPoolCardsModal(state.pools.find((pool) => pool.id === id));
    } else if (action === 'delete-pool') {
      if (window.confirm('删除卡池会同时移除它的卡池配置与当日配额记录，确认删除？')) {
        await api(`/pools/${id}`, { method: 'DELETE' });
        showMessage('卡池已删除。', 'success');
        await switchTab('pools');
      }
    } else if (action === 'edit-card') {
      openCardModal(state.cards.find((card) => card.id === id));
    } else if (action === 'delete-card') {
      if (window.confirm('删除卡牌会同时从所有卡池中移除它，确认删除？')) {
        await api(`/cards/${id}`, { method: 'DELETE' });
        showMessage('卡牌已删除。', 'success');
        await switchTab('cards');
      }
    } else if (action === 'view-user-records') {
      await openUserRecordsModal(qq);
    } else if (action === 'reset-user') {
      await openResetModal(qq);
    }
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

/* ---------------- 启动 ---------------- */

(async function boot() {
  if (!state.token) {
    $('loginView').classList.remove('hidden');
    return;
  }
  try {
    await enterApp();
  } catch (error) {
    logout();
    $('loginMsg').textContent = error.message;
    $('loginMsg').className = 'msg show error';
  }
})();
