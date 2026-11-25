// 摇一摇检测：三重判据，以累计变化(churn)为主——轻摇即触发，走路/静止不误触。
//   1. churn  窗口内相邻帧三轴变化累计（持续摇动）
//   2. sum    三轴峰峰值平方和（大幅慢摇兜底）
//   3. delta  单帧三轴最大跳变（最灵敏，轻抖一下即触发）

const WINDOW_MS = 300;
const MIN_SAMPLES = 3;
const CHURN_THRESHOLD = 35;
const SUM_THRESHOLD = 150;
const DELTA_THRESHOLD = 4;
const COOLDOWN = 700;

function createDetector() {
  let samples = [];
  return {
    reset() { samples = []; },
    push(x, y, z, now) {
      const t = now == null ? Date.now() : now;
      samples.push({ t, x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0 });
      while (samples.length && t - samples[0].t > WINDOW_MS) samples.shift();
      if (samples.length < MIN_SAMPLES) return { hit: false };

      let churn = 0, maxDelta = 0;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s.x < minX) minX = s.x;
        if (s.x > maxX) maxX = s.x;
        if (s.y < minY) minY = s.y;
        if (s.y > maxY) maxY = s.y;
        if (s.z < minZ) minZ = s.z;
        if (s.z > maxZ) maxZ = s.z;
        if (i > 0) {
          const p = samples[i - 1];
          const d = Math.abs(s.x - p.x) + Math.abs(s.y - p.y) + Math.abs(s.z - p.z);
          churn += d;
          if (d > maxDelta) maxDelta = d;
        }
      }
      const px = maxX - minX, py = maxY - minY, pz = maxZ - minZ;
      const sum = px * px + py * py + pz * pz;
      return { hit: churn > CHURN_THRESHOLD || sum > SUM_THRESHOLD || maxDelta >= DELTA_THRESHOLD };
    },
  };
}

module.exports = { createDetector, COOLDOWN };
