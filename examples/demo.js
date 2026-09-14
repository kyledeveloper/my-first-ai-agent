const i18n = require('../src/i18n');

console.log('=== 🇨🇳 中文输出 ===');
console.log(i18n.t('app.title'));
console.log(i18n.t('common.welcome', { name: 'Kyle' }));
console.log('按钮示例:', i18n.t('action.save'), '/', i18n.t('action.cancel'));

// 切换到英文
i18n.changeLanguage('en-US');

console.log('\n=== 🇺🇸 English Output ===');
console.log(i18n.t('app.title'));
console.log(i18n.t('common.welcome', { name: 'Kyle' }));
console.log('Buttons:', i18n.t('action.save'), '/', i18n.t('action.cancel'));
