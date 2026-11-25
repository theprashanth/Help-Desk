/**
 * Every fixed piece of text the Messenger shows, in English. With Settings › Multilingual on, the
 * Messenger shows these in the visitor's browser language: the server translates this exact set (plus the
 * workspace's own greeting and welcome text) once per language with the AI provider and caches it.
 * `{name}`-style placeholders are filled in by the Messenger and must survive translation.
 */
export const MESSENGER_STRINGS = {
  hello: 'Hello there!',
  startChat: 'Start a New Chat',
  recentConversations: 'Recent conversations',
  seeAll: 'See all ({count})',
  allConversations: 'All conversations',
  openConversation: 'Open conversation',
  yourTickets: 'Your tickets',
  allTickets: 'All tickets',
  ticket: 'Ticket',
  stateInProgress: 'In progress',
  stateWaiting: 'Waiting on you',
  stateResolved: 'Resolved',
  knownIssue: 'Known issue',
  updated: 'Updated {time}',
  beginning: 'Beginning of secure chat session.',
  firstMessage: 'Type your first message to start the chat…',
  message: 'Message…',
  chooseOption: 'Choose an option above',
  uploading: 'Uploading…',
  justNow: 'Just now',
  sendFailed: 'Your message couldn’t be sent. Please try again.',
  sendOffline: 'Your message couldn’t be sent. Check your connection and try again.',
  oneOnline: '{name} is online',
  twoOnline: '{a} & {b} are online',
  manyOnline: '{names} & {last} are online',
  replyAsap: 'We’ll reply as soon as we can',
  awayBack: 'We’re away right now — back {when}',
  replyMinutes: 'We usually reply in a few minutes',
  replyHours: 'We usually reply in a few hours',
  replyDay: 'We usually reply in a day',
  searchHelp: 'Search for help',
  popularArticles: 'Popular articles',
  loading: 'Loading…',
  articleHelpful: 'Did this answer your question?',
  yes: 'Yes',
  no: 'No',
  stillNeedHelp: 'Still need help? Message us',
  thanksHelped: 'Thanks! Glad it helped.',
  sorryHelp: 'Sorry about that. Our team can help.',
  rateThanks: 'Thanks for your feedback!',
  rateMore: 'Tell us more (optional)',
  sendFeedback: 'Send feedback',
  sending: 'Sending…',
  rateTerrible: 'Terrible',
  rateBad: 'Bad',
  rateOk: 'OK',
  rateGreat: 'Great',
  rateAmazing: 'Amazing',
} as const;

export type MessengerStringKey = keyof typeof MESSENGER_STRINGS;
export type MessengerStrings = Record<MessengerStringKey, string> & { welcome?: string; greeting?: string };

/** Fill `{name}` placeholders. */
export const fillString = (s: string, vars: Record<string, string | number> = {}) =>
  s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
