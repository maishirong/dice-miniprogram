const store = require('./utils/store.js');
const brand = require('./utils/brand.js');

App({
  globalData: {
    appName: 'WorkBuddy 小程序',
    brandName: '', // 启动时解析出的商家定制标题
  },
  onLaunch(options) {
    this._resolveBrand(options);
  },
  onShow(options) {
    // 从分享/扫码再次进入也会带参数，这里再解析一次
    this._resolveBrand(options);
  },
  _resolveBrand(options) {
    const name = brand.extractBrandName(options);
    if (name) {
      store.saveBrandName(name);
      this.globalData.brandName = name;
    } else {
      // 无参数：读本地之前保存过的名字；从未设置则为空，页面用默认
      this.globalData.brandName = store.getBrandName();
    }
  },
});
