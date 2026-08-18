// src/lib/sort.js —— 表头三态排序（asc→desc→复位）状态机 + 空值（null/undefined/空串）行恒排最后的排序应用；双端共享纯模块（原四处同构实现收敛于此）
import { isEmptyVal, compareValues } from './util.js';

/** 返回 { key, dir, active, toggle(key), reset(), apply(list, val) }；apply 未激活时原样返回 list（保持原引用）；表头 ▲/▼ 指示由各视图自行渲染（见调用处） */
export function createSort() {
  let s = { key: null, dir: 1 };
  return {
    get key() {
      return s.key;
    },
    get dir() {
      return s.dir;
    },
    get active() {
      return s.key != null;
    },
    toggle(key) {
      if (s.key === key) s = s.dir === 1 ? { key, dir: -1 } : { key: null, dir: 1 };
      else s = { key, dir: 1 };
    },
    reset() {
      s = { key: null, dir: 1 };
    },
    apply(list, val) {
      if (!s.key) return list;
      const { key, dir } = s;
      return [...list].sort((a, b) => {
        const va = val(a, key),
          vb = val(b, key);
        if (isEmptyVal(va) && isEmptyVal(vb)) return 0;
        if (isEmptyVal(va)) return 1;
        if (isEmptyVal(vb)) return -1;
        return compareValues(va, vb) * dir;
      });
    },
  };
}
