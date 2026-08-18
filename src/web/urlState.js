// src/web/urlState.js —— 视图状态 URL 持久化（?view=&tab=&role=&disc=，replaceState 不产生历史记录），刷新/分享链接不丢状态。
// 旧值（recommend/discstats/card/table）由 migrateViewState 一次性迁移，不再保留兼容分支。
import { userConfig, saveUserConfig } from './data.js';
import { VIEWS, VIEW_VALUES } from '../lib/constants.js';
import { myTab, setMyTab } from './myChars.js';
import { wikiTab, setWikiTab } from './wiki.js';
import { statsTab, setStatsTab, selectedRole, setSelectedRole } from './statsView.js';
import { selectedDisc, setSelectedDisc } from './discstats.js';
import { simTab, setSimTab } from './simulate.js';

/** 各一级视图的合法子 tab 键（URL 恢复时白名单校验） */
const URL_TABS = {
  [VIEWS.MY_CHARS]: ['card', 'table'],
  [VIEWS.WIKI]: ['characters', 'wengines', 'discs', 'bangboos'],
  [VIEWS.STATS]: ['detail', 'discs', 'overview'],
  [VIEWS.SIMULATE]: ['frontier', 'prob'],
};

/** 当前视图的子 tab 值（URL 写入用） */
function currentTab(view) {
  if (view === VIEWS.MY_CHARS) return myTab;
  if (view === VIEWS.WIKI) return wikiTab;
  if (view === VIEWS.STATS) return statsTab;
  if (view === VIEWS.SIMULATE) return simTab;
  return null;
}

/** 视图持久化值一次性迁移（2026-11）：历史值 recommend/discstats → stats、card/table → mychars。
 *  仅旧书签/旧 user-config 触发；迁移后 URL 与配置即新值，代码不再保留旧值兼容分支。 */
export function migrateViewState() {
  const LEGACY_VIEW = { recommend: VIEWS.STATS, discstats: VIEWS.STATS, card: VIEWS.MY_CHARS, table: VIEWS.MY_CHARS };
  const p = new URLSearchParams(location.search);
  const urlView = p.get('view');
  if (urlView && LEGACY_VIEW[urlView]) {
    p.set('view', LEGACY_VIEW[urlView]);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }
  const cfgView = userConfig.view;
  if (cfgView && LEGACY_VIEW[cfgView]) {
    userConfig.view = LEGACY_VIEW[cfgView];
    saveUserConfig();
  }
}

/** 把当前 视图/子tab/角色/盘 状态写入 URL。每次状态切换后调用。
 *  view 缺省时沿用 URL 已有 view（子 tab 切换场景），否则回退 userConfig.view——避免把 loadUserConfig 之前的默认 mychars 写进 URL。 */
export function syncUrl(view) {
  if (!view) {
    const raw = new URLSearchParams(location.search).get('view') || userConfig.view || VIEWS.MY_CHARS;
    view = VIEW_VALUES.has(raw) ? raw : VIEWS.MY_CHARS;
  }
  const p = new URLSearchParams();
  if (view !== VIEWS.MY_CHARS) p.set('view', view);
  const tab = currentTab(view);
  if (tab) p.set('tab', tab);
  if (view === VIEWS.STATS) {
    if (selectedRole) p.set('role', selectedRole);
    if (selectedDisc) p.set('disc', selectedDisc);
  }
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

/** 首次渲染前从 URL 恢复 子tab/角色/盘 状态（一级 view 由 render.js 的 resolveView 解析）。 */
export function applyUrlState() {
  const p = new URLSearchParams(location.search);
  const raw = p.get('view') || userConfig.view || VIEWS.MY_CHARS;
  const view = VIEW_VALUES.has(raw) ? raw : VIEWS.MY_CHARS;
  const tab = p.get('tab');
  if (tab && (URL_TABS[view] || []).includes(tab)) {
    if (view === VIEWS.MY_CHARS) setMyTab(tab);
    else if (view === VIEWS.WIKI) setWikiTab(tab);
    else if (view === VIEWS.STATS) setStatsTab(tab);
    else if (view === VIEWS.SIMULATE) setSimTab(tab);
  }
  if (view === VIEWS.STATS) {
    if (p.get('role')) setSelectedRole(p.get('role'));
    if (p.get('disc')) setSelectedDisc(p.get('disc'));
  }
}
