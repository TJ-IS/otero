import { Router } from 'express';
import { streamText, convertToModelMessages, pipeTextStreamToResponse } from 'ai';
import { Item } from '../../models/Item.js';
import { buildPaperContext, getChatModel } from '../../services/chatService.js';
import { config } from '../../config.js';
import { hideFromPublic } from '../../services/itemVisibility.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const chatRouter = Router();

// POST /api/items/:key/chat  { messages: UIMessage[] }
// Plain-text streaming response (consumed by the frontend's
// TextStreamChatTransport / useChat). Open to all visitors (see
// editorWriteGate's publicWrites exemption) — no wallet/editor auth.
chatRouter.post(
  '/items/:key/chat',
  asyncHandler(async (req, res) => {
    const it = await Item.loadByKey(req.params.key);
    if (!it || hideFromPublic(req, it)) return res.status(404).json({ error: 'not found' });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'messages required' });
    }

    let system;
    try {
      system = await buildPaperContext(req.params.key);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const trimmed = messages.slice(-config.chat.maxHistoryMessages);

    const result = streamText({
      model: getChatModel(),
      system,
      messages: await convertToModelMessages(trimmed),
      temperature: 0.3,
      timeout: config.chat.timeoutMs,
      onError: ({ error }) => console.error('chat streamText error:', error),
    });

    pipeTextStreamToResponse({ response: res, stream: result.textStream });
  }),
);
