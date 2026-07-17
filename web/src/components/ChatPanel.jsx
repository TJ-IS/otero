import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, X, Send, Trash2, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { getChatPresets, clearChatHistory, loadChatHistory, saveChatHistory } from '@/lib/chat';

function messageText(message) {
  return message.parts
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span className="motion-typing-dot size-1.5 rounded-full bg-current" style={{ animationDelay: '-0.3s' }} />
      <span className="motion-typing-dot size-1.5 rounded-full bg-current" style={{ animationDelay: '-0.15s' }} />
      <span className="motion-typing-dot size-1.5 rounded-full bg-current" />
    </span>
  );
}

function ChatBubble({ role, text, streaming }) {
  const isUser = role === 'user';
  const isEmpty = !text;
  return (
    <div className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary mt-0.5">
          <Sparkles className="size-3.5 text-secondary-foreground" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3.5 py-2 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground border',
        )}
      >
        {isEmpty ? (
          streaming ? <TypingDots /> : null
        ) : isUser ? (
          <span className="whitespace-pre-wrap break-words">{text}</span>
        ) : (
          <div className="chat-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        )}
        {streaming && !isEmpty && (
          <span className="motion-status inline-block w-1.5 h-3.5 bg-current opacity-50 align-middle ml-0.5 animate-pulse" />
        )}
      </div>
      {isUser && (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary mt-0.5">
          <User className="size-3.5 text-secondary-foreground" />
        </div>
      )}
    </div>
  );
}

export const ChatPanel = memo(function ChatPanel({ itemKey }) {
  const { t } = useTranslation(['item', 'common']);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [panelPresent, setPanelPresent] = useState(false);
  const [panelState, setPanelState] = useState('closed');
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);
  const presets = getChatPresets();

  const transport = useRef(null);
  if (!transport.current || transport.current.itemKey !== itemKey) {
    transport.current = Object.assign(
      new TextStreamChatTransport({ api: `/api/items/${itemKey}/chat` }),
      { itemKey },
    );
  }

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    id: itemKey,
    transport: transport.current,
    messages: loadChatHistory(itemKey),
  });

  const sending = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    let frame;
    let closeTimer;

    if (open) {
      setPanelPresent(true);
      frame = requestAnimationFrame(() => setPanelState('open'));
    } else {
      setPanelState('closed');
      closeTimer = setTimeout(() => setPanelPresent(false), 220);
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [open]);

  useEffect(() => {
    setMessages(loadChatHistory(itemKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  useEffect(() => {
    saveChatHistory(itemKey, messages);
  }, [itemKey, messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => () => stop(), [stop]);

  const send = useCallback((text) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    sendMessage({ text: trimmed });
    setInput('');
  }, [sending, sendMessage]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    send(input);
  }, [input, send]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }, [input, send]);

  const handleClear = useCallback(() => {
    clearChatHistory(itemKey);
    setMessages([]);
  }, [itemKey, setMessages]);

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant={open ? 'outline' : 'default'}
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-5 right-5 z-40 size-12 rounded-full shadow-lg"
        title={t('chat.title')}
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </Button>

      {panelPresent && (
        <>
          {isMobile && (
            <button
              type="button"
              aria-label={t('chat.close')}
              tabIndex={-1}
              onClick={() => setOpen(false)}
              data-state={panelState}
              className="chat-scrim fixed inset-0 z-40 cursor-default bg-black/20 backdrop-blur-[2px]"
            />
          )}
          <div
            className={cn(
              'chat-panel z-50 flex flex-col bg-background border shadow-2xl overflow-hidden',
              isMobile
                ? 'fixed inset-0'
                : 'fixed bottom-[5.5rem] right-5 w-[400px] h-[600px] max-h-[calc(100vh-7rem)] rounded-2xl',
            )}
            data-state={panelState}
          >
            <div className="flex items-center justify-between gap-2 border-b bg-background px-4 py-3 shrink-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-muted-foreground" />
                {t('chat.assistant')}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" onClick={handleClear} title={t('chat.clear')}>
                  <Trash2 className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} title={t('common:close')}>
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-8">
                  {t('chat.hint')}
                </div>
              )}
              {messages.map((m, i) => (
                <ChatBubble
                  key={m.id ?? i}
                  role={m.role}
                  text={messageText(m)}
                  streaming={sending && i === messages.length - 1 && m.role === 'assistant'}
                />
              ))}
            </div>

            <div className="border-t px-3 py-2 space-y-2 shrink-0">
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    disabled={sending}
                    onClick={() => send(p.prompt)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <form onSubmit={handleSubmit} className="flex items-end gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('chat.placeholder')}
                  className="min-h-[40px] max-h-28 text-sm resize-none py-2"
                  disabled={sending}
                />
                <Button type="submit" size="icon" className="shrink-0" disabled={sending || !input.trim()}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
});
