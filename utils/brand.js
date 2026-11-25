// 商家定制标题：从进入参数中解析店名。
// 支持三种入口：
//   1. 分享/小程序码 query:  ?title=欣欣小酒馆 · 骰盅游戏
//   2. 小程序码 scene:       scene=title=欣欣小酒馆 · 骰盅游戏（解码后可能是 key=value 或纯标题）
//   3. 自定义编译/URL Link:  query.name / query.brand / query.shop 等
// 解析不到时返回空串，调用方用默认标题。

const VALUE_KEYS = ['title', 'brandName', 'brand', 'shopName', 'shop', 'name'];
const CLEAR_WORDS = ['default', 'reset', '默认', '清除'];

function decode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

function extractBrandName(options) {
  const opts = options || {};
  const q = opts.query || {};
  let raw = '';

  // 1) query 中明确的标题字段
  for (let i = 0; i < VALUE_KEYS.length; i++) {
    if (q[VALUE_KEYS[i]]) { raw = q[VALUE_KEYS[i]]; break; }
  }
  // 2) query.scene（分享卡片 / getUnlimited 小程序码）
  if (!raw && q.scene) raw = q.scene;
  // 3) 顶层 options.scene（扫码进入）
  if (!raw && opts.scene) raw = opts.scene;
  if (!raw) return '';

  raw = decode(String(raw));

  // key=value 形式取等号后的值
  const m = raw.match(/^(?:title|name|brand|shop|brandName|s|b)=(.+)$/i);
  if (m) raw = m[1];
  raw = decode(raw).trim();

  // 纯数字是内置场景值（1001 等），不是标题
  if (/^\d+$/.test(raw)) return '';
  // 明确请求恢复默认
  if (CLEAR_WORDS.indexOf(raw.toLowerCase()) >= 0) return '';

  return raw.slice(0, 24);
}

// 标题字数多时缩小字号，避免溢出（默认 76rpx）
function titleFontSize(name) {
  const len = name ? name.length : 0;
  if (len <= 5) return 76;
  if (len <= 8) return 56;
  if (len <= 12) return 44;
  return 36;
}

module.exports = { extractBrandName, titleFontSize };
