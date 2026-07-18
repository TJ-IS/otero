# 010 — Confirm before clearing chat history

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: — (missed opportunity / additive)
- **Category**: Missed opportunities (Feedback / prevent slips)
- **Estimated scope**: 3 files (`ChatPanel.jsx`, `en/item.json`, `zh-CN/item.json`)

## Problem

Clearing the paper assistant wipes history on a single click with no confirm.

```jsx
/* web/src/components/ChatPanel.jsx:150-153 — current */
const handleClear = useCallback(() => {
  clearChatHistory(itemKey);
  setMessages([]);
}, [itemKey, setMessages]);
```

```jsx
/* web/src/components/ChatPanel.jsx:195-196 — current trigger */
<Button variant="ghost" size="icon" className="size-7 ..." onClick={handleClear} title={t('chat.clear')}>
  <Trash2 className="size-3.5" />
</Button>
```

Prefer **AlertDialog** (matches delete item / empty trash) over hold-to-confirm — cohesive with this crisp admin/library app, and AlertDialog will pick up `motion-panel` from plan 001.

## Target

1. Trash button opens confirm dialog; does not clear immediately.
2. Confirm action runs existing `handleClear` logic.
3. Cancel / dismiss leaves messages intact.

Use the shared AlertDialog primitive:

```jsx
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
```

Pattern exemplar: `web/src/components/ItemDetail.jsx:946-958` (delete confirm).

i18n — add under `chat` in both locale files:

```json
/* web/src/locales/en/item.json — add beside chat.clear */
"clearConfirmTitle": "Clear conversation?",
"clearConfirmDesc": "This removes the chat history for this paper from this browser.",
"clearConfirmAction": "Clear"
```

```json
/* web/src/locales/zh-CN/item.json */
"clearConfirmTitle": "清空对话？",
"clearConfirmDesc": "将删除本篇论文在此浏览器中的聊天记录。",
"clearConfirmAction": "清空"
```

Reuse `common:cancel` for the cancel button if that key exists (it does elsewhere).

Dialog motion: no custom animation classes — rely on AlertDialog (+ plan 001 `motion-panel`).

## Repo conventions to follow

- Exemplar: `ItemDetail.jsx` delete AlertDialog.
- Strings live in `web/src/locales/*/item.json` under `chat.*`.
- Destructive confirm uses `AlertDialogAction` (primary); optional `className` with destructive styles only if ItemDetail/Trash do the same for delete — match whichever pattern is closer (Trash uses destructive styling on the action).

## Steps

1. Add i18n keys to `en/item.json` and `zh-CN/item.json`.
2. In `ChatPanel.jsx`, add `clearConfirmOpen` state; Trash `onClick` → `setClearConfirmOpen(true)`.
3. Render `AlertDialog` with title/description/action calling `handleClear` then closing.
4. Disable or hide clear when `messages.length === 0` (optional UX polish — recommended).

## Boundaries

- Do NOT implement hold-to-confirm fill animation in this plan.
- Do NOT change chat transport, presets, or streaming UI.
- Do NOT clear history on dialog open — only on confirm.
- Do NOT add new dependencies.

## Verification

- **Mechanical**: open chat on an item, send a message, click Trash → dialog; Cancel keeps messages; Confirm empties UI and storage for that item key.
- **Feel check**:
  - Accidental click no longer wipes history.
  - Dialog motion matches other AlertDialogs (after plan 001, reduced-motion fades only).
  - No enter animation on the Trash icon itself beyond Button `motion-press`.
- **Done when**: clear requires explicit confirm; en + zh-CN strings present; cancel is safe.
