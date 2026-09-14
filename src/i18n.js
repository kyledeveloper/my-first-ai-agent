const i18next = require('i18next');
const zhCNCommon = require('../locales/zh-CN/common.json');
const enUSCommon = require('../locales/en-US/common.json');

// Initialize i18next instance
i18next.init({
  lng: 'zh-CN', // Default language
  fallbackLng: 'en-US',
  resources: {
    'zh-CN': {
      common: zhCNCommon
    },
    'en-US': {
      common: enUSCommon
    }
  },
  defaultNS: 'common',
  interpolation: {
    escapeValue: false // not needed for node/react
  }
});

module.exports = i18next;
