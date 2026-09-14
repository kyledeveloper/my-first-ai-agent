---
name: i18n
description: 'Use for user-facing strings and react-i18next locale keys, namespaces, interpolation, translations or bun run i18n.'
user-invocable: false
---

# LobeHub Internationalization Guide

- Default language: English (en-US)
- Framework: react-i18next
- **Only edit files in `packages/locales/src/default/`** - Never edit JSON files in `locales/` (except hand-written en-US/zh-CN previews)
- Leave generated locales to the daily `auto-i18n.yml` workflow by default; run `bun run i18n` manually only when they are needed immediately

## Key Naming Convention

**Flat keys with dot notation** (not nested objects):

```typescript
// ✅ Correct
export default {
  'alert.cloud.action': 'Try Now',
  'sync.actions.sync': 'Sync Now',
  'sync.status.ready': 'Connected',
};

// ❌ Avoid nested objects
export default {
  alert: { cloud: { action: '...' } },
};
```

**Patterns:** `{feature}.{context}.{action|status}`

**Parameters:** Use `{{variableName}}` syntax

```typescript
'alert.cloud.desc': 'We provide {{credit}} credits',
```

**Avoid key conflicts:**

```typescript
// ❌ Conflict
'clientDB.solve': 'Self Resolve',
'clientDB.solve.backup.title': 'Data Backup',

// ✅ Solution
'clientDB.solve.action': 'Self Resolve',
'clientDB.solve.backup.title': 'Data Backup',
```

## Workflow

1. Add keys to `packages/locales/src/default/{namespace}.ts`
2. Export new namespace in `packages/locales/src/default/index.ts`
3. For dev preview: manually translate `locales/zh-CN/{namespace}.json` and `locales/en-US/{namespace}.json`
4. Leave all other locales to `.github/workflows/auto-i18n.yml`, which runs daily and opens an automated translation PR
5. Run `bun run i18n` manually only when the branch needs those translations immediately; it is slow and requires `OPENAI_API_KEY`

## Usage

```tsx
import { useTranslation } from 'react-i18next';

const { t } = useTranslation('common');

t('newFeature.title');
t('alert.cloud.desc', { credit: '1000' });

// Multiple namespaces
const { t } = useTranslation(['common', 'chat']);
t('common:save');
```

## Common Namespaces

**Most used:** `common` (shared UI), `chat` (chat features), `setting` (settings)

Others: auth, changelog, components, discover, editor, electron, error, file, hotkey, knowledgeBase, memory, models, plugin, portal, providers, tool, topic
