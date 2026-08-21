// src/web/collect.js —— 「我的角色」采集书签（GitHub Pages 静态版专用）
// 用法：在米游社网页版（user.mihoyo.com 域，需已登录）执行本脚本（书签注入）：
//   在浏览器收藏一个书签，地址填：
//   javascript:(function(){var s=document.createElement('script');s.src='REPLACE_WITH_DEPLOYED_URL/collect.js';document.body.appendChild(s)})()
// 然后打开 user.mihoyo.com（米游社网页版，需已登录），点该书签 → 脚本在米游社域内运行：
//   fetch 账号接口（CORS 仅放行米游社域来源、无 DS 签名）→ 抓全部角色 → 复制 characters JSON 到剪贴板。
// 回到配装面板 GitHub Pages 版 →「我的角色」空态/「数据导入」→ 粘贴 → 存 localStorage。
// ⚠️ cookie 只在本脚本执行时用于请求，不写入任何存储；请勿把含 cookie 的页面脚本粘贴到不明来源。

(() => {
  const BASE = 'https://api-takumi-record.mihoyo.com';
  const HDR = {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://act.mihoyo.com',
    Referer: 'https://act.mihoyo.com/',
    'X-Requested-With': 'com.mihoyo.hyperion',
    'x-rpc-app_version': '2.75.2',
    'x-rpc-device_id': '06770e63-c0e8-38da-89bd-1a1e504b6bfd',
    'x-rpc-device_name': 'Redmi%2023113RKC6C',
    'x-rpc-device_fp': '38d7fe73b1032',
    'x-rpc-sys_version': '9',
    'x-rpc-platform': '2',
    'x-rpc-language': 'zh-cn',
    'x-rpc-lang': 'zh-cn',
  };
  // 与 src/lib/util.js 的 parseNum 同口径：带 % 转成小数（"9.6%" → 0.096），纯数字原样；空/非法 → null。
  // ⚠️ 曾只剥 % 不除 100，导致暴击率/暴伤等百分比属性大 100 倍。
  const parseNum = (s) => {
    if (s == null || s === '') return null;
    const str = String(s);
    const n = parseFloat(str);
    if (!Number.isFinite(n)) return null;
    return str.includes('%') ? n / 100 : n;
  };
  const collectStats = (arr) => {
    const out = [];
    for (const p of arr || []) {
      const name = p && p.property_name;
      if (!name) continue;
      const n = parseNum(p && p.base);
      if (n == null) continue;
      out.push({ name, value: n });
    }
    return out;
  };
  const extract = (a) => {
    const panel = {};
    for (const p of a.properties || []) {
      const name = p && p.property_name;
      if (!name) continue;
      panel[name] = { base: parseNum(p.base), bonus: parseNum(p.add), final: parseNum(p.final) };
    }
    const w = a.weapon || {};
    const wengine = {
      name: w.name || '未佩戴音擎',
      level: w.level ?? null,
      refinement: w.star ?? w.refine_level ?? w.refine ?? 1,
      icon: w.icon || '',
      specialEffectTitle: w.talent_title || '',
      specialEffect: w.talent_content || '',
      mainStats: collectStats(w.main_properties),
      subStats: collectStats(w.properties),
    };
    const discs = (a.equip || []).map((e, i) => ({
      set: (e.equip_suit && e.equip_suit.name) || e.name || '未知',
      slot: i + 1,
      level: e.level ?? null,
      icon: (e.equip_suit && e.equip_suit.icon) || e.icon || '',
      rarity: e.rarity || 'S',
      mainStats: collectStats(e.main_properties),
      subStats: collectStats(e.properties),
    }));
    while (discs.length < 6)
      discs.push({ set: '未佩戴驱动盘', slot: discs.length + 1, level: null, mainStats: [], subStats: [] });
    return {
      name: (a.full_name_mi18n || a.name_mi18n || String(a.id)).replace(/\s+/g, ''),
      id: String(a.id),
      level: a.level ?? null,
      icon: a.role_square_url || a.group_icon_path || a.hollow_icon_path || a.icon || '',
      rarity: a.rarity || '',
      faction: a.camp_name_mi18n || '',
      panel,
      wengine,
      discs: discs.slice(0, 6),
      elementType: a.element_type ?? null,
      profession: a.avatar_profession ?? null,
      subElementType: a.sub_element_type ?? null,
      verticalPaintingColor: a.vertical_painting_color || '',
      usName: a.us_full_name || '',
      skins: (a.skin_list || []).map((s) => ({
        id: s.skin_id,
        name: s.skin_name || '',
        square: s.skin_square_url || '',
        icon: s.skin_hollow_icon_path || '',
        color: s.skin_vertical_painting_color || '',
        unlocked: !!s.unlocked,
        rarity: s.rarity || '',
        isOriginal: !!s.is_original,
      })),
      mindscape: {
        rank: a.rank ?? 0,
        ranks: (a.ranks || []).map((r) => ({
          id: r.id,
          name: r.name || '',
          pos: r.pos,
          isUnlocked: !!r.is_unlocked,
          desc: r.desc || '',
        })),
      },
      skills: (a.skills || []).map((s) => ({
        type: s.skill_type,
        level: s.level,
        items: (s.items || []).map((it) => ({ title: it.title || '', text: it.text || '', awaken: !!it.awaken })),
      })),
      skillAwaken: a.skill_awaken
        ? {
            hasSystem: !!a.skill_awaken.has_awaken_system,
            level: a.skill_awaken.awaken_level ?? 0,
            maxLevel: a.skill_awaken.awaken_max_level ?? 0,
            items: a.skill_awaken.skill_awaken_items || [],
          }
        : null,
      equipPlan: a.equip_plan_info || null,
    };
  };
  const copy = (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(text)).catch(() => fallback(text));
    } else fallback(text);
  };
  const fallback = (text) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    done(text);
  };
  const done = (text) => {
    const len = text.length;
    alert(
      '已抓取 ' + (len / 1024).toFixed(1) + ' KB 角色数据：已复制到剪贴板，并下载了 zzz-chars.json。\n' +
        '电脑：到配装面板「数据导入」直接粘贴。\n' +
        '手机：把 zzz-chars.json 传到手机（微信文件助手等），用「数据导入 → 选择 JSON 文件」导入。'
    );
    try {
      // 自动下载 JSON 文件（手机端导入的入口：手机无法运行书签/控制台）
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zzz-chars.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch { /* 下载被拦则仅剪贴板可用 */ }
  };
  // 进度浮层：注入米游社页面的固定提示条（内联样式避开站点样式干扰），展示当前步骤与抓取计数
  let progressEl = null;
  const progress = (msg) => {
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.style.cssText =
        'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;' +
        'background:rgba(0,0,0,0.88);color:#ffd400;padding:12px 22px;border-radius:10px;' +
        'font:700 15px/1.7 sans-serif;max-width:82vw;box-shadow:0 6px 28px rgba(0,0,0,0.55);' +
        'text-align:center;white-space:pre-line;border:1px solid rgba(255,212,0,0.4);';
      document.body.appendChild(progressEl);
    }
    progressEl.textContent = msg;
  };
  const hideProgress = () => {
    if (progressEl) {
      progressEl.remove();
      progressEl = null;
    }
  };
  (async () => {
    try {
      // 1. uid
      progress('正在获取米游社账号信息…');
      const uidJ = await fetch('https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=nap_cn', {
        credentials: 'include',
        headers: HDR,
      }).then((r) => r.json());
      const uid = uidJ && uidJ.data && uidJ.data.list && uidJ.data.list[0] && uidJ.data.list[0].game_uid;
      if (!uid) throw new Error('账号下没有绝区零角色（请确认已登录米游社且 cookie 有效）');
      // 2. 角色列表
      const listJ = await fetch(
        BASE + '/event/game_record_zzz/api/zzz/avatar/basic?server=prod_gf_cn&role_id=' + uid,
        { credentials: 'include', headers: HDR }
      ).then((r) => r.json());
      const list = (listJ && listJ.data && listJ.data.avatar_list) || [];
      if (!list.length) throw new Error('角色列表为空');
      progress('账号已确认（' + uid + '）\n找到 ' + list.length + ' 个角色，正在抓取详情…');
      // 3. 详情（并发 3，防风控）
      const chars = [];
      let got = 0;
      for (let i = 0; i < list.length; i += 3) {
        const batch = await Promise.all(
          list.slice(i, i + 3).map(async (x) => {
            try {
              const url =
                BASE + '/event/game_record_zzz/api/zzz/avatar/info?id_list[]=' + x.id + '&need_wiki=true&server=prod_gf_cn&role_id=' + uid;
              const j = await fetch(url, {
                credentials: 'include',
                headers: Object.assign({}, HDR, {
                  'x-rpc-page': 'v1.1.4_#/zzz/roles/' + x.id + '/detail',
                  'x-rpc-geetest_ext': JSON.stringify({ viewUid: '0', gameId: 8, page: 'v1.1.4_#/zzz/roles/' + x.id + '/detail', isHost: 1 }),
                }),
              }).then((r) => r.json());
              const a = j && j.data && j.data.avatar_list && j.data.avatar_list[0];
              if (!a) return null;
              const c = extract(a);
              if (!c.icon) c.icon = x.icon || '';
              return c;
            } catch (e) {
              console.error('采集失败：', x.id, e);
              return null;
            }
          })
        );
        const ok = batch.filter(Boolean);
        chars.push(...ok);
        got += ok.length;
        progress('正在抓取角色详情… ' + got + ' / ' + list.length);
      }
      if (!chars.length) throw new Error('一个角色都没拉到（cookie 可能过期）');
      hideProgress();
      copy(JSON.stringify(chars));
    } catch (e) {
      hideProgress();
      alert('采集失败：' + e.message + '\n请确认当前页面是米游社网页版（user.mihoyo.com），且已登录。');
    }
  })();
})();
