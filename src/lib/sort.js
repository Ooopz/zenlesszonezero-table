// src/lib/sort.js —— 表头三态排序（asc → desc → 复位）状态机 + 空值排最后的排序应用
// 双端共享纯模块（无 node 依赖）。wiki / 统计表 / 方案表 / 驱动盘统计四处原各有一份
// 同构实现，统一收敛到这里。空值（null/undefined/空串）行恒排最后，不受升降序影响。
import { isEmptyVal, compareValues } from './util.js';

/** 创建一套排序状态。返回 { key, dir, active, toggle(key), reset(), apply(list, val) }。
 *  - toggle(key)：同列 升→降→复位，新列从升序开始（三态状态机）
 *  - apply(list, val)：val(item, key) 取排序值；未激活排序时原样返回 list（保持原引用）
 *  - 注意表头 ▲/▼ 指示仍由各视图自行渲染（差异过大，见各调用处），这里只负责状态与排序 */
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
        if (isEmptyVal(va)) return 1; // 无值行（null/undefined/空串）始终排最后
        if (isEmptyVal(vb)) return -1;
        return compareValues(va, vb) * dir;
      });
    },
  };
}
