const store = require('../../utils/store.js');
const dice = require('../../utils/dice-engine.js');
const shake = require('../../utils/shake.js');
const brand = require('../../utils/brand.js');

const MIN = 1, MAX = 12;

Page({
  data: {
    title: '萬事勝意',
    titleFontSize: 76,
    wordmark: 'AFTER HOURS',
    count: 5,
    rolling: false,
    resolved: false,
    cupOpen: false,
    outcome: '准备就绪',
    showSettings: false,
    soundOn: true,
    shakeOn: true,
    tapRollOn: false,
    shakeTip: '',
    loaded: false,
    landscape: false,
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({ landscape: sys.windowWidth > sys.windowHeight });
    const s = store.getSettings();
    this.setData({ soundOn: s.soundOn, shakeOn: s.shakeOn, tapRollOn: s.tapRollOn });
    this._sounds = {};
    this._soundIdx = {};
    this._lastShake = 0;
    this._lastTap = 0;
    this._shakeHandler = null;
    this._detector = shake.createDetector();
    this._shakeRetry = 0;
    this._updateShakeTip(sys);
  },

  onReady() {
    this._initCanvas();
  },

  onShow() {
    // 商家标题可能由分享/扫码参数带入，每次显示都刷新一次
    this._applyBrandTitle();
    // 切后台再回前台，微信会停掉加速度传感器；开关开着就必须重新挂上
    if (this.data.shakeOn) this._attachShake();
  },

  _applyBrandTitle() {
    // app.onLaunch/onShow 已把参数写入本地并放到 globalData，这里统一读取生效值
    let name = '';
    try {
      const app = getApp();
      name = (app && app.globalData && app.globalData.brandName) || store.getBrandName() || '';
    } catch (e) {
      name = store.getBrandName() || '';
    }
    if (name) {
      this.setData({ title: name, titleFontSize: brand.titleFontSize(name) });
      try { wx.setNavigationBarTitle({ title: name }); } catch (e) {}
    }
    // 无名字：保持默认——页面大字「萬事勝意」、导航栏「酒桌骰趣」
  },

  onHide() {
    // 离开前台时停采样省电；监控句柄保留，onShow 会重新激活
    try { wx.stopAccelerometer(); } catch (e) {}
  },

  onUnload() {
    if (this._engine) this._engine.destroy();
    Object.keys(this._sounds).forEach(k => this._sounds[k].forEach(a => a.destroy()));
    this._detachShake();
  },

  _updateShakeTip(sys) {
    let tip = '开启后摇动手机即可掷骰。';
    const d = this.data;
    if (d.shakeOn) {
      if (d.shakeSensor === 'denied') {
        tip = '传感器被系统拦截：请在微信「设置—关于—权限管理」允许运动与方向。';
      } else if (d.shakeSensor === 'error') {
        tip = '传感器启动失败，请关闭再打开开关重试。';
      } else if (d.shakeSensor === 'on') {
        tip = '已开启，摇动手机即可掷骰（轻微震动为反馈）。';
      } else {
        tip = '正在启动摇一摇…';
      }
    }
    this.setData({ shakeTip: tip });
  },

  _initCanvas() {
    wx.createSelectorQuery().in(this).select('#playfield').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        this.setData({ outcome: '画布初始化失败' });
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const sys = wx.getSystemInfoSync();
      const dpr = Math.min(sys.pixelRatio || 1, 2.5);
      const w = res[0].width, h = res[0].height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));

      this._initSounds();

      // 骰盅显示宽度约占舞台 68%，作为骰子布局的缩放基准（与新 H5 一致）
      const cupScale = 0.68;
      const engine = dice.createEngine({
        canvas,
        ctx,
        cupScale,
        play: (name, vol) => this._play(name, vol),
        onResolved: (values, total) => {
          store.addRoll({ ts: Date.now(), faces: values, total, count: values.length });
          this.setData({ rolling: false, resolved: true, outcome: '掷骰完成' });
        },
        onRollingChange: (rolling) => this.setData({ rolling }),
      });
      this._engine = engine;

      let loadedCount = 0;
      const paths = [1, 2, 3, 4, 5, 6].map(i => '/assets/dice/face' + i + '.png');
      paths.forEach((src, i) => {
        const img = canvas.createImage();
        img.onload = () => {
          engine.setImage(i, img);
          loadedCount++;
          if (loadedCount === paths.length) {
            engine.resize(w, h, dpr);
            engine.start();
            this.setData({ loaded: true });
          }
        };
        img.onerror = () => {
          this.setData({ outcome: '骰子图片载入失败' });
        };
        img.src = src;
      });
    });
  },

  _initSounds() {
    // iOS 静音键会屏蔽 InnerAudioContext；新基础库用全局设置绕过（旧属性 obeyMuteSwitch 已废弃）
    try {
      if (wx.setInnerAudioOption) {
        wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true, fail: () => {} });
      }
    } catch (e) {}
    this._soundReady = {};
    ['roll', 'shake', 'click', 'tap'].forEach(name => {
      const pool = [];
      for (let i = 0; i < 2; i++) {
        const a = wx.createInnerAudioContext();
        try { a.obeyMuteSwitch = false; } catch (e) {}
        a.volume = .4;
        // 真机首次加载需解码完成后才能播放，记录就绪状态供 _play 等待
        a.onCanplay(() => { this._soundReady[name] = true; });
        a.src = '/assets/snd/' + name + '.mp3';
        pool.push(a);
      }
      this._sounds[name] = pool;
    });
  },

  _play(name, vol) {
    if (!this.data.soundOn) return;
    const pool = this._sounds[name];
    if (!pool || !pool.length) return;
    this._soundIdx[name] = ((this._soundIdx[name] || 0) + 1) % pool.length;
    const a = pool[this._soundIdx[name]];
    const doPlay = () => {
      try {
        a.stop();
        a.volume = typeof vol === 'number' ? vol : .4;
        a.seek(0);
        a.play();
      } catch (e) {}
    };
    // 未就绪：轮询等待 onCanplay 后再播（真机首次加载慢，直接 play 会静默失败）
    if (!this._soundReady[name]) {
      let tries = 0;
      const wait = () => {
        if (this._soundReady[name]) doPlay();
        else if (tries++ < 12) setTimeout(wait, 100); // 最多等 1.2s
      };
      setTimeout(wait, 100);
      return;
    }
    doPlay();
  },

  onRoll() {
    if (!this._engine || !this.data.loaded) return;
    // 与「点击摇骰子按钮」完全等价：先自恢复，若引擎内部仍卡住则强制复位再掷，
    // 保证每一次摇动命中都必定启动一次掷骰（不会因为假死被吞掉）
    this._engine.kick();
    let started = this._engine.roll();
    if (!started) {
      this._engine.forceReset();
      started = this._engine.roll();
    }
    if (started) {
      this._play('click', .3);
      this.setData({
        resolved: false,
        cupOpen: false, // 掷骰时盖回骰盅，与新 H5 一致
        outcome: '掷骰中',
      });
    }
  },

  onCupTap() {
    // 点骰盅掀开/盖回，查看骰子结果（与 H5 的 cup-control 行为一致）
    if (!this.data.loaded || this.data.rolling || this.data.showSettings) return;
    this._play('tap', .28);
    this.setData({ cupOpen: !this.data.cupOpen });
  },

  onPlus() {
    if (this._engine && this._engine.changeCount(1, MIN, MAX)) this.setData({ count: this._engine.getCount() });
  },

  onMinus() {
    if (this._engine && this._engine.changeCount(-1, MIN, MAX)) this.setData({ count: this._engine.getCount() });
  },

  openSettings() {
    this._play('click', .25);
    this._updateShakeTip();
    this.setData({ showSettings: true });
  },

  closeSettings() {
    this.setData({ showSettings: false });
  },

  noop() {},

  toggleSound() {
    const next = !this.data.soundOn;
    this.setData({ soundOn: next });
    store.saveSettings({ soundOn: next });
    if (next) this._play('tap', .3);
  },

  toggleTap() {
    const next = !this.data.tapRollOn;
    this.setData({ tapRollOn: next });
    store.saveSettings({ tapRollOn: next });
    this._play('tap', .3);
  },

  toggleShake() {
    const next = !this.data.shakeOn;
    this.setData({ shakeOn: next });
    store.saveSettings({ shakeOn: next });
    if (next) {
      this._attachShake();
    } else {
      this._detachShake();
    }
    this._updateShakeTip();
  },

  _detachShake() {
    if (this._shakeHandler) {
      try { wx.offAccelerometerChange(this._shakeHandler); } catch (e) {}
      this._shakeHandler = null;
    }
    if (this._detector) this._detector.reset();
    try { wx.stopAccelerometer(); } catch (e) {}
    if (this.data.shakeSensor !== 'off') this.setData({ shakeSensor: 'off' });
  },

  _attachShake() {
    // 先确保事件监听只挂一次
    if (!this._shakeHandler) {
      this._shakeHandler = (e) => {
        const a = e.accelerationIncludingGravity || e;
        const now = Date.now();
        const r = this._detector.push(a.x, a.y, a.z, now);
        // 过冷却即触发；由 onRoll 内部的 kick + engine.roll() 保证命中必掷
        if (r.hit && now - this._lastShake > shake.COOLDOWN) {
          this._lastShake = now;
          this._detector.reset(); // 触发后清空窗口，避免一次甩动连掷多次
          try { wx.vibrateShort({ type: 'light' }); } catch (err) {}
          this.onRoll();
        }
      };
      wx.onAccelerometerChange(this._shakeHandler);
    }

    // 传感器是否真的启动成功，必须有 success/fail 回调确认（真机静默失败是主要坑）
    this.setData({ shakeSensor: 'starting' });
    this._updateShakeTip();
    try { wx.stopAccelerometer(); } catch (e) {}
    wx.startAccelerometer({
      interval: 'game', // game 约 60Hz；normal 在部分安卓机低至 1Hz 会漏采
      success: () => {
        this._shakeRetry = 0;
        if (this.data.shakeOn && this.data.shakeSensor !== 'on') {
          this.setData({ shakeSensor: 'on' });
          this._updateShakeTip();
        }
      },
      fail: (err) => {
        // game 频率在部分机型不支持，降级 normal 再试一次
        if (this._shakeRetry === 0) {
          this._shakeRetry = 1;
          try { wx.stopAccelerometer(); } catch (e) {}
          wx.startAccelerometer({
            interval: 'normal',
            success: () => {
              if (this.data.shakeOn && this.data.shakeSensor !== 'on') {
                this.setData({ shakeSensor: 'on' });
                this._updateShakeTip();
              }
            },
            fail: (err2) => {
              const msg = String((err2 && err2.errMsg) || (err && err.errMsg) || '');
              const denied = /auth|deny|permission|scope/i.test(msg);
              if (this.data.shakeOn) {
                this.setData({ shakeSensor: denied ? 'denied' : 'error' });
                this._updateShakeTip();
              }
            },
          });
        } else {
          const msg = String((err && err.errMsg) || '');
          const denied = /auth|deny|permission|scope/i.test(msg);
          if (this.data.shakeOn) {
            this.setData({ shakeSensor: denied ? 'denied' : 'error' });
            this._updateShakeTip();
          }
        }
      },
    });
  },

  onStageTap() {
    if (!this.data.tapRollOn || this.data.showSettings) return;
    const now = Date.now();
    if (now - this._lastTap < 320) {
      this._lastTap = 0;
      this.onRoll();
    } else {
      this._lastTap = now;
    }
  },
});
