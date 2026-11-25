// 商家定制标题：从进入参数中解析店名。
// 支持三种入口：
//   1. 分享/小程序码 query:  ?title=欣欣小酒馆 · 骰盅游戏
//   2. 小程序码 scene（太阳码，中文经 base64url 编码）:
//        scene=n=5qyi5qyi5bCP6ZWS6YaG   （解码为「欣欣小酒馆」，自动补后缀）
//        scene=5qyi5qyi5bCP6ZWS6YaG      （纯编码亦可）
//   3. 自定义编译/URL Link:  query.name / query.brand / query.shop 等
// 解析不到时返回空串，调用方用默认标题。

const VALUE_KEYS = ['title', 'brandName', 'brand', 'shopName', 'shop', 'name'];
const CLEAR_WORDS = ['default', 'reset', '默认', '清除'];
const SUFFIX = ' · 骰盅游戏';

function decode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

// base64url 字符还原为标准 base64
function toBase64(code) {
  let b64 = String(code).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return b64;
}

// base64 -> UTF-8 字节（小程序用 wx.base64ToArrayBuffer，浏览器用 atob 兜底）
function base64Bytes(b64) {
  if (typeof wx !== 'undefined' && wx.base64ToArrayBuffer) {
    return new Uint8Array(wx.base64ToArrayBuffer(b64));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// UTF-8 字节 -> 中文字符串
function utf8Decode(bytes) {
  let out = '', i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xE0) out += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i++] & 0x3F));
    else if (c < 0xF0) out += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
    else out += String.fromCharCode(((c & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
  }
  return out;
}

// 尝试把 scene 里的 base64url 解码成中文店名；失败返回 ''
function decodeSceneName(scene) {
  const s = decode(String(scene)).trim();
  const m = s.match(/^(?:n|name|title|s|b)=(.+)$/i);
  const code = m ? m[1] : s;
  // base64url 只含字母数字 - _，长度合理才尝试
  if (!/^[A-Za-z0-9_-]{6,}$/.test(code) || code.length > 48) return '';
  try {
    const text = utf8Decode(base64Bytes(toBase64(code))).trim();
    if (!text || !/[\u4e00-\u9fa5]/.test(text)) return '';
    return text.indexOf('骰盅游戏') >= 0 ? text : text + SUFFIX;
  } catch (e) {
    return '';
  }
}

function extractBrandName(options) {
  const opts = options || {};
  const q = opts.query || {};
  let raw = '';

  // 1) query 中明确的标题字段
  for (let i = 0; i < VALUE_KEYS.length; i++) {
    if (q[VALUE_KEYS[i]]) { raw = q[VALUE_KEYS[i]]; break; }
  }

  // 2) scene：先尝试 base64url 中文解码（太阳码），失败再当明文
  const scene = q.scene || opts.scene;
  if (!raw && scene) {
    raw = decodeSceneName(scene);
    if (!raw) raw = decode(String(scene));
  }
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

module.exports = { extractBrandName, titleFontSize, decodeSceneName };
