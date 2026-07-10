import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, X, Send, Trash2, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { CHAT_PRESETS, clearChatHistory, loadChatHistory, saveChatHistory } from '@/lib/chat';

function messageText(message) {
  return message.parts
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span className="size-1.5 rounded-full bg-current opacity-40 animate-bounce [animation-delay:-0.3s]" />
      <span className="size-1.5 rounded-full bg-current opacity-40 animate-bounce [animation-delay:-0.15s]" />
      <span className="size-1.5 rounded-full bg-current opacity-40 animate-bounce" />
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
          <span className="inline-block w-1.5 h-3.5 bg-current opacity-50 align-middle ml-0.5 animate-pulse" />
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
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

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
        title="与论文助手对话"
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </Button>

      {open && (
        <>
          {isMobile && (
            <button
              type="button"
              aria-label="关闭对话"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default bg-black/20 backdrop-blur-[2px] animate-in fade-in duration-150"
            />
          )}
          <div
            className={cn(
              'z-50 flex flex-col bg-background border shadow-2xl overflow-hidden animate-in slide-in-from-right-full duration-200',
              isMobile
                ? 'fixed inset-0'
                : 'fixed bottom-[5.5rem] right-5 w-[400px] h-[600px] max-h-[calc(100vh-7rem)] rounded-2xl',
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b bg-background px-4 py-3 shrink-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-muted-foreground" />
                论文助手
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" onClick={handleClear} title="清空对话">
                  <Trash2 className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} title="关闭">
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-8">
                  针对这篇论文提问，或选择下面的快捷问题开始。
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
                {CHAT_PRESETS.map((p) => (
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
                  placeholder="输入问题，Enter 发送，Shift+Enter 换行…"
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
