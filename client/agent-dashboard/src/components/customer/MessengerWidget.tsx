import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../../context/SocketContext';
import { Message, Conversation, Attachment } from '../../../../../shared/src/types';
import { MessageSquare, X, Send, Paperclip, Smile, ArrowLeft, Check, CheckCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const BACKEND_URL = 'http://localhost:3000';

export const MessengerWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'chat'>('home');
  const [guestId, setGuestId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [localConversations, setLocalConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [agentTyping, setAgentTyping] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  
  const socket = useSocket();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<any>(null);

  // Initialize Guest User
  useEffect(() => {
    let id = localStorage.getItem('customer_guest_id');
    if (!id) {
      id = `guest_${Math.random().toString(36).substring(2, 11)}`;
      localStorage.setItem('customer_guest_id', id);
    }
    setGuestId(id);

    let name = localStorage.getItem('customer_guest_name');
    if (!name) {
      name = `Guest #${id.slice(-4)}`;
      localStorage.setItem('customer_guest_name', name);
    }
    setGuestName(name);
  }, []);

  // Fetch Guest's active conversations
  useEffect(() => {
    if (!guestId) return;

    const fetchGuestConvs = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/tickets?assignedAgentId=&search=${guestId}`);
        if (res.ok) {
          const data: Conversation[] = await res.json();
          // Filter strictly owned conversations
          const filtered = data.filter(c => c.customer.id === guestId);
          setLocalConversations(filtered);
        }
      } catch (err) {
        console.error('Failed to fetch customer conversations:', err);
      }
    };

    fetchGuestConvs();

    // Listen for updates with explicit callbacks
    const handleConvUpdate = (conv: Conversation) => {
      if (conv.customer.id === guestId) {
        setLocalConversations(prev => {
          const idx = prev.findIndex(c => c.id === conv.id);
          if (idx === -1) return [conv, ...prev];
          const next = [...prev];
          next[idx] = conv;
          return next;
        });
        if (activeConv && activeConv.id === conv.id) {
          setActiveConv(conv);
        }
      }
    };

    const handleConvNew = (conv: Conversation) => {
      if (conv.customer.id === guestId) {
        setLocalConversations(prev => [conv, ...prev]);
      }
    };

    if (socket) {
      socket.on('conversation:update', handleConvUpdate);
      socket.on('conversation:new', handleConvNew);
    }

    return () => {
      if (socket) {
        socket.off('conversation:update', handleConvUpdate);
        socket.off('conversation:new', handleConvNew);
      }
    };
  }, [guestId, socket, activeConv]);

  // Handle socket rooms and live messaging for selected conversation
  useEffect(() => {
    if (!activeConv || !socket) return;

    // Join room
    socket.emit('join', activeConv.id);

    // Fetch message logs
    const fetchMessages = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/messages/${activeConv.id}`);
        if (res.ok) {
          const data: Message[] = await res.json();
          // Filter out internal notes for customer view
          const publicMsgs = data.filter(m => !m.isInternalNote);
          setChatMessages(publicMsgs);
          
          // Mark seen on load
          await fetch(`${BACKEND_URL}/api/messages/seen/${activeConv.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'customer' })
          });
        }
      } catch (e) {
        console.error('Error fetching chat logs:', e);
      }
    };

    fetchMessages();

    // Handle typing events with explicit callback references
    const handleTyping = (payload: { conversationId: string; senderType: 'customer' | 'agent'; senderName: string; isTyping: boolean }) => {
      if (payload.conversationId === activeConv.id && payload.senderType === 'agent') {
        setAgentTyping(payload.isTyping ? payload.senderName : null);
      }
    };

    // Handle seen receipts
    const handleSeen = (payload: { conversationId: string; seenAt: string; role: 'customer' | 'agent' }) => {
      if (payload.conversationId === activeConv.id && payload.role === 'agent') {
        setChatMessages(prev => prev.map(m => m.sender.type === 'customer' ? { ...m, seen: true, seenAt: payload.seenAt } : m));
      }
    };

    // Handle new messages
    const handleNewMsg = (msg: Message) => {
      if (msg.conversationId === activeConv.id && !msg.isInternalNote) {
        setChatMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });

        // Auto seen if window is active
        if (isOpen && activeTab === 'chat') {
          fetch(`${BACKEND_URL}/api/messages/seen/${activeConv.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'customer' })
          });
        }
      }
    };

    socket.on('message:typing', handleTyping);
    socket.on('message:seen', handleSeen);
    socket.on('message:new', handleNewMsg);

    return () => {
      socket.emit('leave', activeConv.id);
      socket.off('message:typing', handleTyping);
      socket.off('message:seen', handleSeen);
      socket.off('message:new', handleNewMsg);
    };
  }, [activeConv, socket, isOpen, activeTab]);

  // Scroll to bottom helper
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, agentTyping]);

  // Typing event emitter
  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    
    if (!socket || !activeConv) return;
    
    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing', {
        conversationId: activeConv.id,
        senderType: 'customer',
        senderName: guestName,
        isTyping: true
      });
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Debounce type turning off
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socket.emit('typing', {
        conversationId: activeConv.id,
        senderType: 'customer',
        senderName: guestName,
        isTyping: false
      });
    }, 2000);
  };

  const handleSendMessage = async (textToSend?: string, files?: Attachment[]) => {
    const text = textToSend !== undefined ? textToSend : inputText;
    if (!text.trim() && (!files || files.length === 0)) return;
    if (!activeConv) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConv.id,
          sender: {
            type: 'customer',
            id: guestId,
            name: guestName
          },
          content: text,
          attachments: files || [],
          isInternalNote: false
        })
      });

      if (res.ok) {
        if (textToSend === undefined) setInputText('');
        // Trigger scroll
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      }
    } catch (err) {
      console.error('Failed to post customer message:', err);
    }
  };

  // Launch a new Support conversation ticket
  const startNewConversation = async () => {
    try {
      const userAgent = navigator.userAgent;
      const browser = userAgent.includes('Chrome') ? 'Chrome' : userAgent.includes('Safari') ? 'Safari' : 'Firefox';
      
      const res = await fetch(`${BACKEND_URL}/api/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: guestId,
          name: guestName,
          priority: 'medium',
          category: 'general',
          initialMessage: 'Hi there! I would like to start a support request.',
          session: {
            country: 'United States',
            browser,
            os: 'macOS',
            device: 'Desktop',
            ip: '127.0.0.1',
            currentPage: window.location.pathname,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString()
          }
        })
      });

      if (res.ok) {
        const conv: Conversation = await res.json();
        setActiveConv(conv);
        setActiveTab('chat');
      }
    } catch (err) {
      console.error('Failed to start chat:', err);
    }
  };

  // Upload attachment file handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConv) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${BACKEND_URL}/api/messages/upload`, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        const attachment: Attachment = await res.json();
        await handleSendMessage('', [attachment]);
      }
    } catch (err) {
      console.error('Failed uploading attachment:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setInputText(prev => prev + emoji);
    setShowEmoji(false);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Messenger Screen Container */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.9 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="w-96 h-[550px] bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden mb-4"
          >
            {/* Header: Intercom Gradient style */}
            <div className="bg-gradient-to-r from-brand-600 to-brand-500 p-6 text-white flex flex-col gap-4 relative">
              <button 
                onClick={() => setIsOpen(false)}
                className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="flex items-center gap-3">
                {activeTab === 'chat' && (
                  <button 
                    onClick={() => setActiveTab('home')}
                    className="p-1 rounded-full hover:bg-white/10 mr-1 transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <div>
                  <h3 className="font-bold text-lg tracking-wide">Customer Messenger</h3>
                  <p className="text-xs text-brand-100 flex items-center gap-1.5 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    We reply in a few minutes
                  </p>
                </div>
              </div>

              {/* Support Avatars Facepile */}
              <div className="flex items-center gap-2 mt-1">
                <div className="flex -space-x-2">
                  <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=50&h=50&fit=crop" className="w-8 h-8 rounded-full border-2 border-brand-500 object-cover" alt="Agent" />
                  <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=50&h=50&fit=crop" className="w-8 h-8 rounded-full border-2 border-brand-500 object-cover" alt="Agent" />
                </div>
                <span className="text-xs text-brand-50 font-medium">Sarah & Emma are online</span>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 flex flex-col">
              {activeTab === 'home' ? (
                /* Home View: Create / Join existing conversations */
                <div className="p-6 flex flex-col gap-6 flex-1 justify-center text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="p-4 bg-brand-50 dark:bg-brand-950/40 rounded-full text-brand-500 mb-2">
                      <MessageSquare className="w-10 h-10" />
                    </div>
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Hello there!</h4>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[280px]">
                      Start a chat with our support team or resume previous discussions.
                    </p>
                  </div>

                  <button
                    onClick={startNewConversation}
                    className="w-full bg-brand-500 hover:bg-brand-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-brand-500/20 active:scale-[0.98] transition-all"
                  >
                    Start a New Chat
                  </button>

                  {/* Previous Conversations */}
                  {localConversations.length > 0 && (
                    <div className="flex flex-col gap-3 text-left mt-4 border-t border-slate-100 dark:border-slate-800/80 pt-4">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Recent Conversations
                      </span>
                      <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                        {localConversations.map(c => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setActiveConv(c);
                              setActiveTab('chat');
                            }}
                            className="w-full p-3 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-200/50 dark:border-slate-800 rounded-xl transition-all flex justify-between items-center"
                          >
                            <div className="flex flex-col gap-1 pr-4 truncate">
                              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{c.ticketNumber}</span>
                              <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{c.lastMessageSnippet || 'Open ticket'}</span>
                            </div>
                            {c.unreadCountCustomer > 0 && (
                              <span className="bg-brand-500 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                                {c.unreadCountCustomer}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Chat view */
                <div className="flex flex-col flex-1 h-full overflow-hidden">
                  {/* Message feed */}
                  <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                    {chatMessages.length === 0 && (
                      <p className="text-xs text-slate-400 text-center my-6">Beginning of secure chat session.</p>
                    )}
                    
                    {chatMessages.map(m => {
                      const isMe = m.sender.type === 'customer';
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col max-w-[75%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}
                        >
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 px-1">
                            {m.sender.name}
                          </span>
                          
                          <div
                            className={`p-3 rounded-2xl text-sm ${
                              isMe
                                ? 'bg-brand-500 text-white rounded-tr-none'
                                : 'bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none'
                            }`}
                          >
                            {m.content && <p className="leading-relaxed whitespace-pre-wrap">{m.content}</p>}
                            
                            {/* File Attachments */}
                            {m.attachments && m.attachments.length > 0 && (
                              <div className="flex flex-col gap-1.5 mt-1">
                                {m.attachments.map((a, idx) => (
                                  <a
                                    key={idx}
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${
                                      isMe
                                        ? 'bg-brand-600/50 border-brand-400/50 hover:bg-brand-600 text-white'
                                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                                    }`}
                                  >
                                    {a.type === 'image' ? (
                                      <img src={a.url} alt={a.name} className="w-16 h-16 rounded object-cover border" />
                                    ) : (
                                      <Paperclip className="w-4 h-4 shrink-0" />
                                    )}
                                    <span className="truncate max-w-[120px]">{a.name}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          {/* Receipt */}
                          {isMe && (
                            <span className="text-[9px] text-slate-400 mt-1 flex items-center gap-0.5">
                              {m.seen ? (
                                <>
                                  <CheckCheck className="w-3.5 h-3.5 text-brand-500" /> Seen
                                </>
                              ) : (
                                <>
                                  <Check className="w-3.5 h-3.5" /> Sent
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* Agent typing */}
                    {agentTyping && (
                      <div className="self-start flex flex-col items-start max-w-[70%]">
                        <span className="text-[10px] text-slate-400 mb-1">{agentTyping} typing</span>
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 p-3 rounded-2xl rounded-tl-none flex gap-1 items-center">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot" />
                        </div>
                      </div>
                    )}
                    
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Typing Composer Panel */}
                  <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 relative">
                    {/* Emoji dropdown picker (simple mockup for UI speed) */}
                    {showEmoji && (
                      <div className="absolute bottom-14 left-4 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl flex gap-2 z-20">
                        {['👍', '👋', '❤️', '😊', '💡', '🎉'].map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => handleEmojiSelect(emoji)}
                            className="text-lg hover:scale-125 transition-transform"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        accept="image/*,application/pdf"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setShowEmoji(!showEmoji)}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Smile className="w-4 h-4" />
                      </button>

                      <input
                        type="text"
                        value={inputText}
                        onChange={handleTextChange}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSendMessage();
                        }}
                        placeholder="Write a message..."
                        className="flex-1 bg-slate-50 dark:bg-slate-950 border-none rounded-xl text-sm px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />

                      <button
                        onClick={() => handleSendMessage()}
                        disabled={!inputText.trim()}
                        className="p-2 bg-brand-500 text-white rounded-xl hover:bg-brand-600 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shadow-md shadow-brand-500/10"
                      >
                        <Send className="w-4.5 h-4.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating launcher bubble */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="bg-brand-500 text-white p-4 rounded-full shadow-2xl hover:bg-brand-600 transition-all flex items-center justify-center border-none"
      >
        {isOpen ? <X className="w-6 h-6 animate-fade-in" /> : <MessageSquare className="w-6 h-6 animate-fade-in" />}
      </motion.button>
    </div>
  );
};

export default MessengerWidget;
