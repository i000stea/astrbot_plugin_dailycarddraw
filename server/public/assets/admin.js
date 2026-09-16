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

function showModalMessage(text, type = 'error') {
  const box = $('modalMsg');
  box.textContent = text;
  box.className = `msg show ${type}`;
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
  const raw = String(rarity ?? '').trim();
  if (!raw) {
    return '<span class="rarity">?</span>';
  }
  if (/^\d+$/.test(raw)) {
    const stars = Number(raw);
    return `<span class="rarity r${stars}">${stars}★</span>`;
  }
  const value = raw.toUpperCase();
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

/** 获取方式统一成数组：接口已返回数组，这里也兼容逗号分隔的历史字符串。 */
function toObtainList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return [];
  }
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return toObtainList(parsed);
      }
    } catch (error) {
      // 忽略，按普通字符串处理
    }
  }
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function obtainText(value) {
  return toObtainList(value).join('、');
}

/** 多选下拉的已选值（忽略「全部」选项的空值）。 */
function getSelectedValues(select) {
  if (!select) {
    return [];
  }
  return [...select.selectedOptions].map((option) => option.value).filter((value) => value !== '');
}

/** 多选下拉规范化：点「全部」只保留全部；已选全部时再选具体值则自动去掉全部。 */
function normalizeMultiSelect(select) {
  if (!select) {
    return;
  }
  const options = [...select.options];
  const current = new Set(options.filter((option) => option.selected).map((option) => option.value));
  const previous = select._prevSelected instanceof Set ? select._prevSelected : new Set(current);
  const allValue = '';
  const next = new Set(current);

  if (next.has(allValue) && !previous.has(allValue)) {
    next.clear();
    next.add(allValue);
  } else if (next.has(allValue) && next.size > 1) {
    next.delete(allValue);
  }
  if (!next.size && options.some((option) => option.value === '')) {
    next.add(allValue);
  }

  options.forEach((option) => {
    option.selected = next.has(option.value);
  });
  select._prevSelected = next;
}

function resetMultiSelect(select) {
  if (!select) {
    return;
  }
  const next = new Set(['']);
  [...select.options].forEach((option) => {
    option.selected = next.has(option.value);
  });
  select._prevSelected = new Set(next);
}

/** 重建选项后恢复已选值；没有匹配项时回到「全部」。 */
function restoreMultiSelect(select, values) {
  if (!select) {
    return;
  }
  const wanted = new Set(values || []);
  const allOption = [...select.options].find((option) => option.value === '');
  const next = new Set();
  [...select.options].forEach((option) => {
    if (option.value === '') {
      option.selected = false;
      return;
    }
    option.selected = wanted.has(option.value);
    if (option.selected) {
      next.add(option.value);
    }
  });
  if (!next.size && allOption) {
    allOption.selected = true;
    next.add('');
  } else if (allOption) {
    allOption.selected = false;
  }
  select._prevSelected = new Set(next);
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
          <button class="ghost small" data-action="copy-pool" data-id="${pool.id}">复制</button>
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

function openCopyPoolModal(pool) {
  const body = `
    <p class="hint">会复制该卡池的卡牌权重、稀有度权重与开关/配额设置，生成一个新卡池。</p>
    <div class="field" style="margin-bottom: 12px">
      <label>新 pool_key（字母数字下划线短横线）</label>
      <input id="cp_pool_key" value="${escapeHtml(pool.pool_key + '_copy')}" />
    </div>
    <div class="field" style="margin-bottom: 12px">
      <label>新卡池名称</label>
      <input id="cp_pool_name" value="${escapeHtml(pool.pool_name + ' 副本')}" />
    </div>
  `;
  openModal(`复制卡池 · ${pool.pool_name}`, body, async () => {
    const payload = {
      pool_key: $('cp_pool_key').value.trim(),
      pool_name: $('cp_pool_name').value.trim(),
    };
    if (!payload.pool_key || !payload.pool_name) {
      showModalMessage('pool_key 与卡池名称都不能为空。');
      return;
    }
    await api(`/pools/${pool.id}/copy`, { method: 'POST', body: payload });
    closeModal();
    await switchTab('pools');
    showMessage(`已复制为「${payload.pool_name}」。`, 'success');
  });
}

/** 本地排序：稀有度 / card_key / 名称（仅用于前端展示）。 */
function sortCards(list, mode) {
  const rank = (card) => Number.parseInt(card.rarity, 10) || 0;
  const key = (card) => String(card.card_key || '');
  const name = (card) => String(card.card_name || '');
  const sorted = [...list];
  switch (mode) {
    case 'rarity_desc':
      sorted.sort((a, b) => rank(b) - rank(a) || key(a).localeCompare(key(b)));
      break;
    case 'rarity_asc':
      sorted.sort((a, b) => rank(a) - rank(b) || key(a).localeCompare(key(b)));
      break;
    case 'key_desc':
      sorted.sort((a, b) => key(b).localeCompare(key(a)));
      break;
    case 'name_asc':
      sorted.sort((a, b) => name(a).localeCompare(name(b), 'zh-Hans-CN'));
      break;
    case 'key_asc':
      sorted.sort((a, b) => key(a).localeCompare(key(b)));
      break;
    default:
      sorted.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  }
  return sorted;
}

async function openPoolCardsModal(pool) {
  const data = await api(`/pools/${pool.id}/cards`);
  const cards = await api('/cards');
  const allCards = cards.list || [];
  const configured = new Map((data.list || []).map((item) => [item.card_id, item]));
  const rarityWeights = new Map((data.rarity_list || []).map((item) => [item.rarity, item]));

  // 编辑态与 DOM 解耦：筛选/排序重建表格时不会丢失改动
  const weightState = new Map();
  allCards.forEach((card) => {
    const current = configured.get(card.id);
    weightState.set(card.id, {
      weight: current ? Number(current.weight) || 0 : 0,
      is_up: Boolean(current && current.is_up),
    });
  });

  const rarityRows = [6, 5, 4, 3, 2, 1]
    .map((rarity) => {
      const row = rarityWeights.get(rarity);
      const weight = row ? row.weight : 0;
      const rate = row ? `${(row.rate * 100).toFixed(2)}%` : '0.00%';
      return `<tr>
        <td>${rarityBadge(rarity)}</td>
        <td><input type="number" min="0" data-rarity-weight="${rarity}" value="${weight}" style="width: 110px" /></td>
        <td class="muted" data-rarity-rate="${rarity}">${rate}</td>
      </tr>`;
    })
    .join('');

  const obtainOptions = [...new Set(allCards.flatMap((card) => toObtainList(card.obtain)))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .map((obtain) => `<option value="${escapeHtml(obtain)}">${escapeHtml(obtain)}</option>`)
    .join('');
  const professionOptions = [...new Set(allCards.map((card) => card.profession).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .map((profession) => `<option value="${escapeHtml(profession)}">${escapeHtml(profession)}</option>`)
    .join('');

  const body = `
    <p class="hint">抽卡分两步：先按「稀有度权重」抽星级，再在该星级内按「卡牌权重」抽具体卡。某星级权重为 0 表示不抽该星级；不配置时退回该星级卡牌权重之和。</p>
    <div class="table-scroll" style="margin-bottom: 14px">
      <table>
        <thead><tr><th>稀有度</th><th>星级权重</th><th>当前概率</th></tr></thead>
        <tbody>${rarityRows}</tbody>
      </table>
    </div>

    <div class="filter-bar">
      <div class="row" style="margin-bottom: 10px">
        <div class="field">
          <label>按获取方式批量操作</label>
          <select id="poolObtainBatch"><option value="">请选择获取方式</option>${obtainOptions}</select>
        </div>
        <div class="field" style="flex: 0 0 auto">
          <button class="ghost small" id="poolBatchAddBtn" type="button">批量加入（权重 1）</button>
        </div>
        <div class="field" style="flex: 0 0 auto">
          <button class="danger small" id="poolBatchRemoveBtn" type="button">批量移除</button>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>搜索</label>
          <input id="poolCardKeyword" placeholder="名称 / card_key" />
        </div>
        <div class="field">
          <label>稀有度</label>
          <select id="poolRarityFilter" multiple title="可按住 Ctrl / ⌘ 多选"><option value="">全部</option>${[6, 5, 4, 3, 2, 1]
            .map((rarity) => `<option value="${rarity}">${rarity}★</option>`)
            .join('')}</select>
        </div>
        <div class="field">
          <label>职业</label>
          <select id="poolProfessionFilter" multiple title="可按住 Ctrl / ⌘ 多选"><option value="">全部</option>${professionOptions}</select>
        </div>
        <div class="field">
          <label>获取方式</label>
          <select id="poolObtainFilter" multiple title="可按住 Ctrl / ⌘ 多选"><option value="">全部</option>${obtainOptions}</select>
        </div>
        <div class="field">
          <label>权重</label>
            <select id="poolWeightFilter">
              <option value="all">显示全部</option>
              <option value="gt0">仅显示权重&gt;0</option>
              <option value="eq0">仅显示权重=0</option>
            </select>
          </div>
          <div class="field">
            <label>排序</label>
          <select id="poolCardSort">
            <option value="default">默认</option>
            <option value="rarity_desc">稀有度 ↓</option>
            <option value="rarity_asc">稀有度 ↑</option>
            <option value="key_asc">card_key ↑</option>
            <option value="key_desc">card_key ↓</option>
            <option value="name_asc">名称</option>
          </select>
        </div>
      </div>
    </div>

    <p class="hint">卡牌权重只决定同星级内部概率，UP 仅作标记。保存后立刻生效。</p>
    <div class="table-scroll">
      <table>
        <thead><tr><th>卡牌</th><th>稀有度</th><th>权重</th><th>UP</th><th>星级内概率</th><th>综合概率</th></tr></thead>
        <tbody id="poolCardBody"></tbody>
      </table>
    </div>
  `;

  function syncFromDom() {
    document.querySelectorAll('[data-card-row]').forEach((row) => {
      const id = Number.parseInt(row.dataset.cardRow, 10);
      const input = row.querySelector('[data-card-weight]');
      const up = row.querySelector('[data-card-up]');
      weightState.set(id, {
        weight: Math.max(0, Number.parseInt(input.value, 10) || 0),
        is_up: Boolean(up && up.checked),
      });
    });
  }

  function recomputeRates() {
    const rarityWeightMap = new Map();
    document.querySelectorAll('[data-rarity-weight]').forEach((input) => {
      rarityWeightMap.set(
        Number.parseInt(input.dataset.rarityWeight, 10),
        Math.max(0, Number.parseInt(input.value, 10) || 0),
      );
    });
    const rarityTotal = [...rarityWeightMap.values()].reduce((sum, value) => sum + value, 0);

    const cardSums = new Map();
    allCards.forEach((card) => {
      const state = weightState.get(card.id);
      const weight = state ? state.weight : 0;
      cardSums.set(card.rarity, (cardSums.get(card.rarity) || 0) + weight);
    });

    document.querySelectorAll('[data-rarity-rate]').forEach((cell) => {
      const rarity = Number.parseInt(cell.dataset.rarityRate, 10);
      const weight = rarityWeightMap.get(rarity) || 0;
      cell.textContent = rarityTotal > 0 ? `${((weight / rarityTotal) * 100).toFixed(2)}%` : '0.00%';
    });

    document.querySelectorAll('[data-card-row]').forEach((row) => {
      const id = Number.parseInt(row.dataset.cardRow, 10);
      const rarity = Number.parseInt(row.dataset.cardRarity, 10);
      const state = weightState.get(id) || { weight: 0 };
      const weight = state.weight || 0;
      const sum = cardSums.get(rarity) || 0;
      const within = sum > 0 ? weight / sum : 0;
      const rarityRate = rarityTotal > 0 ? (rarityWeightMap.get(rarity) || 0) / rarityTotal : 0;
      const withinCell = row.querySelector('[data-within-rate]');
      const overallCell = row.querySelector('[data-overall-rate]');
      if (withinCell) {
        withinCell.textContent = weight > 0 ? `${(within * 100).toFixed(2)}%` : '-';
      }
      if (overallCell) {
        overallCell.textContent = weight > 0 ? `${(within * rarityRate * 100).toFixed(2)}%` : '未加入';
      }
    });
  }

  function renderCardRows() {
    const keyword = $('poolCardKeyword').value.trim().toLowerCase();
    const rarityFilters = getSelectedValues($('poolRarityFilter'));
    const professionFilters = getSelectedValues($('poolProfessionFilter'));
    const obtainFilters = getSelectedValues($('poolObtainFilter'));
    const weightFilter = $('poolWeightFilter').value;
    const sortMode = $('poolCardSort').value;

    let list = allCards.filter((card) => {
      if (keyword && !`${card.card_key || ''} ${card.card_name || ''}`.toLowerCase().includes(keyword)) {
        return false;
      }
      if (rarityFilters.length && !rarityFilters.includes(String(card.rarity))) {
        return false;
      }
      if (professionFilters.length && !professionFilters.includes(card.profession || '')) {
        return false;
      }
      if (obtainFilters.length) {
        const obtains = toObtainList(card.obtain);
        if (!obtainFilters.some((value) => obtains.includes(value))) {
          return false;
        }
      }
      if (weightFilter !== 'all') {
        const weight = (weightState.get(card.id) || { weight: 0 }).weight || 0;
        if (weightFilter === 'gt0' && weight <= 0) {
          return false;
        }
        if (weightFilter === 'eq0' && weight !== 0) {
          return false;
        }
      }
      return true;
    });
    list = sortCards(list, sortMode);

    $('poolCardBody').innerHTML = list.length
      ? list
          .map((card) => {
            const state = weightState.get(card.id) || { weight: 0, is_up: false };
            return `<tr data-card-row="${card.id}" data-card-rarity="${card.rarity}">
              <td>${escapeHtml(card.card_name)}</td>
              <td>${rarityBadge(card.rarity)}</td>
              <td><input type="number" min="0" data-card-weight="${card.id}" value="${state.weight}" style="width: 90px" /></td>
              <td><input type="checkbox" data-card-up="${card.id}" ${state.is_up ? 'checked' : ''} /></td>
              <td class="muted" data-within-rate>-</td>
              <td class="muted" data-overall-rate>-</td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="6" class="muted">没有符合条件的卡牌。</td></tr>';
    recomputeRates();
  }

  function batchByObtain(mode) {
    const obtain = $('poolObtainBatch').value;
    if (!obtain) {
      showModalMessage('请先选择要批量操作的获取方式。');
      return;
    }
    syncFromDom();
    allCards.forEach((card) => {
      if (!toObtainList(card.obtain).includes(obtain)) {
        return;
      }
      const state = weightState.get(card.id) || { weight: 0, is_up: false };
      state.weight = mode === 'add' ? (state.weight > 0 ? state.weight : 1) : 0;
      weightState.set(card.id, state);
    });
    renderCardRows();
    showModalMessage(`已按获取方式「${obtain}」${mode === 'add' ? '批量加入' : '批量移除'}。`, 'success');
  }

  openModal(
    `卡池配置 · ${pool.pool_name}`,
    body,
    async () => {
      syncFromDom();
      const items = [];
      weightState.forEach((state, cardId) => {
        if (state.weight > 0) {
          items.push({ card_id: cardId, weight: state.weight, is_up: state.is_up });
        }
      });
      const rarityItems = [];
      document.querySelectorAll('[data-rarity-weight]').forEach((input) => {
        rarityItems.push({
          rarity: Number.parseInt(input.dataset.rarityWeight, 10),
          weight: Number.parseInt(input.value, 10) || 0,
        });
      });

      await api(`/pools/${pool.id}/cards`, { method: 'PUT', body: { items, rarity_items: rarityItems } });
      closeModal();
      showMessage(`卡池配置已保存（${items.length} 张卡 / ${rarityItems.length} 档稀有度）。`, 'success');
    },
    { wide: true },
  );

  renderCardRows();

  ['poolRarityFilter', 'poolProfessionFilter', 'poolObtainFilter'].forEach((id) => restoreMultiSelect($(id), []));

  // 事件委托：卡牌行会被筛选/排序重建，必须挂在 modalBody 上
  $('modalBody').oninput = (event) => {
    const target = event.target;
    if (target.matches('[data-card-weight]')) {
      syncFromDom();
      recomputeRates();
    } else if (target.matches('[data-rarity-weight]')) {
      recomputeRates();
    } else if (target.id === 'poolCardKeyword') {
      syncFromDom();
      renderCardRows();
    }
  };
  $('modalBody').onchange = (event) => {
    const target = event.target;
    if (target.matches('[data-card-up]')) {
      syncFromDom();
    } else if (['poolRarityFilter', 'poolProfessionFilter', 'poolObtainFilter'].includes(target.id)) {
      normalizeMultiSelect(target);
      syncFromDom();
      renderCardRows();
    } else if (target.id === 'poolWeightFilter' || target.id === 'poolCardSort') {
      syncFromDom();
      renderCardRows();
    } else if (target.matches('[data-card-weight]') && $('poolWeightFilter').value !== 'all') {
      syncFromDom();
      renderCardRows();
    }
  };
  $('poolBatchAddBtn').onclick = () => batchByObtain('add');
  $('poolBatchRemoveBtn').onclick = () => batchByObtain('remove');
}

/* ---------------- 卡牌 ---------------- */

function fillCardFilterOptions() {
  const selected = {
    rarity: getSelectedValues($('cardRarityFilter')),
    profession: getSelectedValues($('cardProfessionFilter')),
    obtain: getSelectedValues($('cardObtainFilter')),
  };

  const rarityOptions = [6, 5, 4, 3, 2, 1]
    .map((rarity) => `<option value="${rarity}">${rarity}★</option>`)
    .join('');
  $('cardRarityFilter').innerHTML = `<option value="">全部稀有度</option>${rarityOptions}`;

  const professions = [...new Set(state.cards.map((card) => card.profession).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  $('cardProfessionFilter').innerHTML = `<option value="">全部职业</option>${professions
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('')}`;

  const obtains = [
    ...new Set(state.cards.flatMap((card) => toObtainList(card.obtain))),
  ].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  $('cardObtainFilter').innerHTML = `<option value="">全部获取方式</option>${obtains
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('')}`;

  restoreMultiSelect($('cardRarityFilter'), selected.rarity);
  restoreMultiSelect($('cardProfessionFilter'), selected.profession);
  restoreMultiSelect($('cardObtainFilter'), selected.obtain);
}

function renderCards() {
  const keyword = $('cardKeyword').value.trim().toLowerCase();
  const rarityFilters = getSelectedValues($('cardRarityFilter'));
  const professionFilters = getSelectedValues($('cardProfessionFilter'));
  const obtainFilters = getSelectedValues($('cardObtainFilter'));
  const sortMode = $('cardSort').value;

  let list = state.cards.filter((card) => {
    if (keyword && !`${card.card_key || ''} ${card.card_name || ''}`.toLowerCase().includes(keyword)) {
      return false;
    }
    if (rarityFilters.length && !rarityFilters.includes(String(card.rarity))) {
      return false;
    }
    if (professionFilters.length && !professionFilters.includes(card.profession || '')) {
      return false;
    }
    if (obtainFilters.length) {
      const obtains = toObtainList(card.obtain);
      if (!obtainFilters.some((value) => obtains.includes(value))) {
        return false;
      }
    }
    return true;
  });
  list = sortCards(list, sortMode);

  $('cardsBody').innerHTML = list.length
    ? list
        .map(
          (card) => `<tr>
          <td>${card.id}</td>
          <td>${escapeHtml(card.card_key)}</td>
          <td>${escapeHtml(card.card_name)}</td>
          <td>${rarityBadge(card.rarity)}</td>
          <td>${card.score_value}</td>
          <td>${escapeHtml(card.profession || '-')}</td>
          <td>${escapeHtml(obtainText(card.obtain) || '-')}</td>
          <td>${yesNo(card.is_enabled)}</td>
          <td>
            <button class="ghost small" data-action="edit-card" data-id="${card.id}">编辑</button>
            <button class="danger small" data-action="delete-card" data-id="${card.id}">删除</button>
          </td>
        </tr>`,
        )
        .join('')
    : '<tr><td colspan="9" class="muted">没有符合条件的卡牌。</td></tr>';
}

async function loadCards() {
  const data = await api('/cards');
  state.cards = data.list || [];
  fillCardFilterOptions();
  renderCards();
}

function cardFormHtml(card = {}) {
  const currentRarity = Number.parseInt(card.rarity, 10) || 6;
  const rarityOptions = [6, 5, 4, 3, 2, 1]
    .map(
      (rarity) =>
        `<option value="${rarity}" ${currentRarity === rarity ? 'selected' : ''}>${rarity}★</option>`,
    )
    .join('');
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
        <select id="c_rarity">${rarityOptions}</select>
      </div>
      <div class="field">
        <label>职业</label>
        <input id="c_profession" value="${escapeHtml(card.profession || '')}" placeholder="近卫 / 狙击 / 术师 ..." />
      </div>
      <div class="field">
        <label>获取方式</label>
        <input id="c_obtain" value="${escapeHtml(toObtainList(card.obtain).join(','))}" placeholder="多个用英文逗号分隔，如：公开招募,中坚寻访" />
      </div>
    </div>
    <div class="row" style="margin-bottom: 12px">
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
      rarity: Number.parseInt($('c_rarity').value, 10),
      profession: $('c_profession').value.trim(),
      obtain: toObtainList($('c_obtain').value),
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

/* ---------------- JSON 批量导入 ---------------- */

function openImportModal(initialText = '') {
  const body = `
    <p class="hint">
      支持 resource/gacha_YYYY-MM-DD.json 的原有格式（对象 map）、卡牌数组，或 {"cards":[...]} 包装。
      字段：id / name / rarity(1~6) / profession / obtain（也兼容 card_key / card_name）。
       obtain 支持 "公开招募,中坚寻访" 这种英文逗号多值，导入时会自动转成数组。
      已存在的 card_key 会更新名称、星级、职业、获取方式与积分。
    </p>
    <div class="field">
      <label>JSON 内容</label>
      <textarea id="importText" rows="12" placeholder='{ "RE21": { "id": "RE21", "name": "机械师", "rarity": 6, "profession": "重装", "obtain": "活动获得" } }'>${escapeHtml(initialText)}</textarea>
    </div>
  `;

  openModal('上传 JSON 录入卡牌', body, async () => {
    const text = $('importText').value.trim();
    if (!text) {
      showModalMessage('请先选择 JSON 文件或粘贴 JSON 内容。');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      showModalMessage(`JSON 解析失败：${error.message}`);
      return;
    }
    const data = await api('/cards/import', { method: 'POST', body: { cards: parsed } });
    closeModal();
    await switchTab('cards');
    const extra = data.skipped ? `，跳过 ${data.skipped} 条` : '';
    showMessage(`导入完成：新增 ${data.created} 条，更新 ${data.updated} 条${extra}。`, 'success');
    if (data.errors && data.errors.length) {
      console.warn('[import] 部分数据被跳过：', data.errors);
    }
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

function openModal(title, bodyHtml, onSubmit, { wide = false } = {}) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  $('modalMsg').className = 'msg';
  state.modalSubmit = onSubmit;
  $('modalSubmit').classList.toggle('hidden', !onSubmit);
  $('modal').querySelector('.card').classList.toggle('wide', Boolean(wide));
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
$('cardSearchBtn').addEventListener('click', () => renderCards());
$('cardKeyword').addEventListener('input', () => renderCards());
$('cardKeyword').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    renderCards();
  }
});
['cardRarityFilter', 'cardProfessionFilter', 'cardObtainFilter'].forEach((id) => {
  $(id).addEventListener('change', () => {
    normalizeMultiSelect($(id));
    renderCards();
  });
});
$('cardSort').addEventListener('change', () => renderCards());
$('cardResetFilterBtn').addEventListener('click', () => {
  $('cardKeyword').value = '';
  resetMultiSelect($('cardRarityFilter'));
  resetMultiSelect($('cardProfessionFilter'));
  resetMultiSelect($('cardObtainFilter'));
  $('cardSort').value = 'default';
  renderCards();
});
$('importCardsBtn').addEventListener('click', () => $('importFileInput').click());
$('importFileInput').addEventListener('change', () => {
  const file = $('importFileInput').files && $('importFileInput').files[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => openImportModal(String(reader.result || ''));
  reader.onerror = () => showMessage('文件读取失败。', 'error');
  reader.readAsText(file, 'utf-8');
  $('importFileInput').value = '';
});
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
      } else if (action === 'copy-pool') {
        openCopyPoolModal(state.pools.find((pool) => pool.id === id));
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
