'use strict';

const API = '/api/daily-carddraw';
const PAGE_SIZE = 10;

const state = {
  qqId: '',
  poolKey: '',
  page: 1,
  total: 0,
};

const $ = (id) => document.getElementById(id);

function showMessage(text, type) {
  const box = $('msg');
  box.textContent = text;
  box.className = `msg show ${type}`;
  if (type === 'success') {
    setTimeout(() => box.classList.remove('show'), 4000);
  }
}

async function request(path, options) {
  const response = await fetch(`${API}${path}`, options);
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

async function loadPools() {
  const data = await request('/pools');
  const select = $('poolKey');
  select.innerHTML = '';
  (data.list || []).forEach((pool) => {
    const option = document.createElement('option');
    option.value = pool.pool_key;
    option.textContent = pool.pool_name;
    select.appendChild(option);
  });
  if (!select.options.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '暂无可用卡池';
    select.appendChild(option);
  }
  state.poolKey = select.value;
}

function renderToday(data) {
  $('poolNameTag').textContent = data.pool_name || '';
  $('singleQuota').textContent = `${data.quota.single_used}/${data.quota.single_limit}`;
  $('tenQuota').textContent = `${data.quota.ten_used}/${data.quota.ten_limit}`;

  const box = $('latestCards');
  if (!data.latest_cards || !data.latest_cards.length) {
    box.innerHTML = '<span class="muted">今天还没有抽卡记录。</span>';
    return;
  }
  box.innerHTML = data.latest_cards
    .map(
      (card) =>
        `<span class="chip">${rarityBadge(card.rarity)} ${card.card_name} <span class="muted">+${card.score}</span></span>`,
    )
    .join('');
}

function renderStats(data) {
  $('totalDraw').textContent = data.total_draw_count;
  $('totalScore').textContent = data.total_score;
  $('ssrCount').textContent = data.total_ssr_count;
  $('urCount').textContent = data.total_ur_count;
  $('nicknameLine').textContent =
    `昵称：${data.nickname || '未记录'} · 单抽 ${data.total_single_draw_count} 次 · 十连 ${data.total_ten_draw_count} 次`;
}

function renderHistory(data) {
  const body = $('historyBody');
  state.total = data.total;
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  $('pageInfo').textContent = `第 ${state.page} / ${totalPages} 页`;
  $('historyTotal').textContent = `共 ${data.total} 条`;
  $('prevPage').disabled = state.page <= 1;
  $('nextPage').disabled = state.page >= totalPages;

  if (!data.list.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted">暂无历史记录。</td></tr>';
    return;
  }

  body.innerHTML = data.list
    .map(
      (item) => `<tr>
        <td>${item.created_at || ''}</td>
        <td>${item.pool_name || ''}</td>
        <td>${item.draw_mode === 'ten' ? '十连' : '单抽'}</td>
        <td>${item.total_score}</td>
        <td>${rarityBadge(item.highest_rarity || '?')}</td>
        <td class="muted">${item.record_no || ''}</td>
      </tr>`,
    )
    .join('');
}

async function search(resetPage = true) {
  const qqId = $('qqId').value.trim();
  if (!qqId) {
    showMessage('请先填写 QQ 号。', 'error');
    return;
  }
  state.qqId = qqId;
  state.poolKey = $('poolKey').value;
  if (resetPage) {
    state.page = 1;
  }

  try {
    const [today, stats, history] = await Promise.all([
      request(`/today?qq_id=${encodeURIComponent(state.qqId)}&pool_key=${encodeURIComponent(state.poolKey)}`),
      request(`/stats?qq_id=${encodeURIComponent(state.qqId)}`),
      request(
        `/history?qq_id=${encodeURIComponent(state.qqId)}&page=${state.page}&page_size=${PAGE_SIZE}`,
      ),
    ]);
    renderToday(today);
    renderStats(stats);
    renderHistory(history);
    $('result').classList.remove('hidden');
    showMessage('查询完成。', 'success');
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

$('searchBtn').addEventListener('click', () => search(true));
$('qqId').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    search(true);
  }
});
$('poolKey').addEventListener('change', () => {
  if (state.qqId) {
    search(true);
  }
});
$('prevPage').addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    search(false);
  }
});
$('nextPage').addEventListener('click', () => {
  if (state.page * PAGE_SIZE < state.total) {
    state.page += 1;
    search(false);
  }
});

loadPools().catch((error) => showMessage(error.message, 'error'));
