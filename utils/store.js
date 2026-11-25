// 本地存储：设置项 + 掷骰历史。接口与云数据层一致，便于日后上云替换。
const KEY_SETTINGS = 'dice.settings';
const KEY_HISTORY = 'dice.history';
const KEY_BRAND = 'dice.brandName';
const MAX_HISTORY = 200;

function read(key, fallback) {
  try {
    const raw = wx.getStorageSync(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
    return { data: value, error: null };
  } catch (e) {
    return { data: null, error: 'CLIENT_EXCEPTION' };
  }
}

const defaultSettings = { soundOn: true, shakeOn: true, tapRollOn: false };

module.exports = {
  getSettings() {
    return Object.assign({}, defaultSettings, read(KEY_SETTINGS, {}));
  },
  saveSettings(patch) {
    const next = Object.assign(this.getSettings(), patch);
    return write(KEY_SETTINGS, next);
  },
  getHistory() {
    return read(KEY_HISTORY, []);
  },
  addRoll(record) {
    const list = this.getHistory();
    list.unshift(record);
    if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
    return write(KEY_HISTORY, list);
  },
  clearHistory() {
    return write(KEY_HISTORY, []);
  },
  // 商家定制标题：带参进入时保存，之后一直使用
  getBrandName() {
    try {
      const v = wx.getStorageSync(KEY_BRAND);
      return typeof v === 'string' ? v : '';
    } catch (e) {
      return '';
    }
  },
  saveBrandName(name) {
    try {
      wx.setStorageSync(KEY_BRAND, String(name || ''));
      return true;
    } catch (e) {
      return false;
    }
  },
};
