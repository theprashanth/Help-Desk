import crypto from 'crypto';
import { ChatFlow, ChatFlowOption, ChatFlowQuestion, ChatFlowSettings, Workspace } from '../../../shared/src/types';

// ── Starting content (from the Chai Shots support flow); everything is editable in Settings › Chat flow ──

const id = () => crypto.randomBytes(5).toString('hex');
const answer = (label: string, text: string): ChatFlowOption => ({ id: id(), label, kind: 'answer', answer: text });
const menu = (label: string, prompt: string, children: ChatFlowOption[]): ChatFlowOption => ({ id: id(), label, kind: 'menu', prompt, children });
const SUB_PROMPT = (title: string) => `${title}\n\nWhat specific issue are you facing? I’ll help you get it sorted in just a few minutes!`;
const CONTACT = '\n\nNeed help? Contact support - we’re here!';

export function defaultChatFlow(): ChatFlow {
  return {
    enabled: false,
    botName: 'Chai Shots Support',
    botSubtitle: 'Here to help, anytime.',
    welcome: 'Hi there! Welcome to Chai Shots Support!\n\nBefore we start, please share 3 quick details so our team can help you.',
    askDetails: true,
    questions: [
      { id: id(), type: 'name', label: 'Your name', placeholder: 'Full name', required: true },
      { id: id(), type: 'phone', label: 'Your mobile number (choose your country code)', placeholder: 'Mobile number', required: true },
      { id: id(), type: 'email', label: 'Your email address (optional)', placeholder: 'name@example.com', required: false },
    ],
    defaultCountry: 'IN',
    detailsPlaceholder: 'Enter details in the input field',
    menuPrompt: 'Thanks, {name}!\nHow can we help you today? Please select an option below.',
    options: [
      menu('My Account Information', SUB_PROMPT('Account Information'), [
        answer('Can\'t log in', 'I understand login issues can be frustrating! 😟\n\n**Let\'s fix this quickly:**\n\n✅ **Quick Checks:**\n1. Correct email/mobile number? (double-check for typos)\n2. Country selected correctly on login screen?\n3. Using a VPN? (disable it and try again)\n4. Internet working? (test with another app)\n\n✅ **OTP Not Received?**\n1. Check email spam/promotions folder (for email OTP)\n2. Check SMS inbox (for mobile OTP)\n3. Tap "Resend OTP"\n4. Try a different network (WiFi to mobile data, or vice versa)\n\n✅ **App Users:**\n1. Update app to latest version (App Store/Play Store)\n2. Restart app completely\n3. If still stuck: Uninstall → Restart phone → Reinstall app\n\n✅ **TV Users:**\n1. Update TV app to latest version (IMPORTANT!)\n2. Unplug TV for 30 seconds → plug back in\n3. Try logging in again\n\n✅ **Still Not Working?**\n**Contact support with:**\n- Device type (iPhone/Android/TV model)\n- Error message (screenshot)\n- Which login method you\'re using (Email OTP or Mobile OTP)\n\nWe\'re here to help!'),
        answer('Forgot Password', 'No worries! 🔑\n\n✅ **Reset your password:**\n1. On the login screen, tap **"Forgot Password"**\n2. Enter your registered email or mobile number\n3. Enter the OTP we send you\n4. Choose a new password and confirm\n\nTip: use at least 8 characters with a mix of letters and numbers.' + CONTACT),
        answer('OTP Not Received', 'Let\'s get you that OTP! 📱\n\n✅ **Quick Checks First:**\n\n1. Using the correct email or mobile number?\n- Double-check for typos\n- Make sure it\'s the one linked to your Chai Shots account\n\n2. Check spam / SMS inbox\n- Email OTPs can land in Spam or Promotions\n- Mobile OTPs can take up to a minute\n\n3. Network\n- Switch between WiFi and mobile data\n- Turn off any VPN\n\n4. Request OTP again\n- Tap "Resend OTP"\n- Wait 30 seconds between requests\n- OTP valid for few minutes only\n\n✅ **Can\'t access your email or mobile number anymore?**\n\nContact our support team - they can help!\n- We\'ll ask security questions to verify your identity\n- Once verified, we can help you regain account access\n- Have your account details ready when you reach out' + CONTACT),
        answer('Change Email or Mobile', '✅ **Update your email or mobile number:**\n1. Go to **"My Chai Shots"** → **Account Settings**\n2. Tap **Email** or **Mobile number**\n3. Enter the new one and verify it with the OTP\n\nYou\'ll need access to the new email/number to receive the OTP.' + CONTACT),
        answer('Logout from All Devices', '✅ **Sign out everywhere:**\n1. Go to **"My Chai Shots"** → **Account Settings**\n2. Tap **"Logout from all devices"**\n3. Confirm\n\nYou\'ll need to log in again on each device.' + CONTACT),
        answer('Create New Profile', '✅ **Add a profile:**\n1. Go to **"My Chai Shots"**\n2. Tap **"Add Profile"**\n3. Choose a name and avatar\n4. Tap **Save**\n\nEach profile gets its own watch history and recommendations.' + CONTACT),
        answer('Delete Profile', 'Removing a profile is straightforward! 🗑️\n\n✅ **How to delete a profile:**\n\n1. Go to "My Chai Shots"\n2. Click "Edit"\n3. Select the profile you want to delete\n4. Click "Delete Profile"\n5. Confirm your action\n\n⚠️ **Important things to know:**\n\n- All watch history and recommendations for that profile will be deleted\n- You cannot undo this action\n- At least one profile must remain on your account\n' + CONTACT),
        answer('Profile Lock & Parental PIN', '✅ **Protect a profile with a PIN:**\n1. Go to **"My Chai Shots"** → **Edit**\n2. Select the profile\n3. Turn on **Profile Lock** and set a 4-digit PIN\n\nForgot the PIN? Reset it from Account Settings using the OTP sent to your registered email/mobile.' + CONTACT),
      ]),
      menu('Subscription & Payments', SUB_PROMPT('Subscription & Payments'), [
        answer('View My Current Plan', '✅ **See your plan:**\n1. Go to **"My Chai Shots"** → **Subscription**\n2. You\'ll see your plan, price and renewal date' + CONTACT),
        answer('Upgrade My Plan', '✅ **Upgrade:**\n1. Go to **"My Chai Shots"** → **Subscription**\n2. Tap **"Upgrade"** and pick a plan\n3. Pay the difference — the new plan starts right away' + CONTACT),
        answer('Payment Issues', '✅ **If a payment failed:**\n1. Check your card/UPI has enough balance and online payments are enabled\n2. Try a different payment method\n3. If money was deducted but the plan isn\'t active, it\'s usually refunded automatically within 5–7 business days\n\nShare your transaction ID with us if it\'s been longer.' + CONTACT),
        answer('Download Invoice', '✅ **Get your invoice:**\n1. Go to **"My Chai Shots"** → **Subscription** → **Billing history**\n2. Tap the payment and choose **"Download invoice"**' + CONTACT),
        answer('Promo Code Issues', '✅ **Promo code not working?**\n1. Check the code for typos (codes are case-sensitive)\n2. Make sure it hasn\'t expired\n3. Some codes only work for new subscribers or specific plans' + CONTACT),
        answer('Subscription Not Active After Payment', '✅ **Paid but still locked?**\n1. Log out and log back in\n2. Make sure you\'re logged in with the account you paid from\n3. Wait up to 15 minutes for the payment to be confirmed\n\nStill not active? Share your transaction ID with us.' + CONTACT),
        answer('Restore Purchase', '✅ **Restore an App Store / Play Store purchase:**\n1. Open the app → **"My Chai Shots"** → **Subscription**\n2. Tap **"Restore Purchase"**\n3. Sign in with the same Apple/Google account you paid with' + CONTACT),
        answer('Charged After Cancellation', '✅ **Charged after cancelling?**\n1. Check the cancellation date — renewals charged before it are valid\n2. App Store / Play Store subscriptions must be cancelled in the store itself\n\nSend us the transaction ID and we\'ll look into a refund.' + CONTACT),
      ]),
      menu('Playback & Streaming', SUB_PROMPT('Playback & Streaming'), [
        answer('Video Buffering', '✅ **Fix buffering:**\n1. Check your internet speed (5 Mbps+ for HD)\n2. Lower the video quality from the player settings\n3. Restart your router and the app' + CONTACT),
        answer('Video Not Playing', '✅ **Video won\'t start?**\n1. Update the app to the latest version\n2. Clear the app cache (Android) or reinstall (iPhone)\n3. Try another title to check if it\'s one video or all' + CONTACT),
      ]),
      menu('Devices & TV', SUB_PROMPT('Devices & TV'), [
        answer('Log in on TV', '✅ **Log in on your TV:**\n1. Open Chai Shots on the TV and choose **"Log in"**\n2. Scan the QR code with your phone, or enter the code shown at chaishots.com/activate\n3. Confirm on your phone' + CONTACT),
        answer('Supported Devices', 'Chai Shots works on Android, iPhone/iPad, web browsers, Android TV, Fire TV, Apple TV and most smart TVs.' + CONTACT),
      ]),
      menu('App & Technical Issues', SUB_PROMPT('App & Technical Issues'), [
        answer('App Crashing', '✅ **App keeps closing?**\n1. Update the app\n2. Restart your phone\n3. Uninstall → Restart phone → Reinstall' + CONTACT),
      ]),
      menu('Content & Search', SUB_PROMPT('Content & Search'), [
        answer('Can\'t Find a Show', '✅ **Looking for something?**\n1. Use **Search** with the show or actor name\n2. Some titles are only available in certain countries\n3. Titles may leave when their licence ends' + CONTACT),
      ]),
    ],
    askResolved: true,
    resolvedQuestion: 'Did this solve your issue?',
    yesLabel: 'Yes — Thanks!',
    noLabel: 'No — Still need help',
    yesReply: 'Glad we could help! 🎉 Have a great day.',
    noReply: 'No problem — connecting you to our support team. Please describe your issue and we’ll reply shortly.',
    showBack: true,
    backLabel: 'Back to categories',
    showRestart: true,
    restartLabel: 'Restart',
    restartMessage: 'Let\'s start again!',
    restartPrompt: 'Please select a support category.',
    menuPlaceholder: 'We are here to help you',
  };
}

export const chatFlowSettingsOf = (ws: Workspace | null): ChatFlowSettings =>
  ws?.chatFlow || { draft: defaultChatFlow(), published: null, version: 0 };

/** The live flow the Messenger should run, or null when off / never published. */
export function liveChatFlow(ws: Workspace | null): { flow: ChatFlow; version: number } | null {
  const s = ws?.chatFlow;
  if (!s?.published?.enabled) return null;
  return { flow: s.published, version: s.version };
}

// ── Validation (what the Settings editor may save) ──────────────────────────

const LIMITS = { short: 120, text: 600, answer: 6000, options: 40, depth: 5, total: 400, questions: 8 };

function str(v: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof v !== 'string') throw new Error(`${field} must be text`);
  const t = v.trim();
  if (!allowEmpty && !t) throw new Error(`${field} can't be empty`);
  if (t.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return t;
}
const bool = (v: unknown, field: string) => { if (typeof v !== 'boolean') throw new Error(`${field} must be true or false`); return v; };
const cleanId = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : id());

export function validateChatFlow(input: any): ChatFlow {
  if (!input || typeof input !== 'object') throw new Error('flow must be an object');
  let count = 0;
  const seen = new Set<string>();
  const option = (o: any, depth: number, where: string): ChatFlowOption => {
    if (++count > LIMITS.total) throw new Error(`At most ${LIMITS.total} options in total`);
    if (!o || typeof o !== 'object') throw new Error(`${where} is invalid`);
    let oid = cleanId(o.id);
    while (seen.has(oid)) oid = id();
    seen.add(oid);
    const label = str(o.label, `${where} label`, LIMITS.short);
    if (o.kind === 'menu') {
      if (depth >= LIMITS.depth) throw new Error(`Menus can be nested at most ${LIMITS.depth} levels deep`);
      const kids = Array.isArray(o.children) ? o.children : [];
      if (!kids.length) throw new Error(`"${label}" opens a menu but has no options in it`);
      if (kids.length > LIMITS.options) throw new Error(`"${label}" has more than ${LIMITS.options} options`);
      return {
        id: oid, label, kind: 'menu',
        prompt: str(o.prompt ?? '', `"${label}" message`, LIMITS.text, true),
        children: kids.map((k: any, i: number) => option(k, depth + 1, `"${label}" option ${i + 1}`)),
      };
    }
    return { id: oid, label, kind: 'answer', answer: str(o.answer, `"${label}" answer`, LIMITS.answer) };
  };

  const questions: ChatFlowQuestion[] = (Array.isArray(input.questions) ? input.questions : []).slice(0, LIMITS.questions).map((q: any, i: number) => {
    if (!['name', 'phone', 'email', 'text'].includes(q?.type)) throw new Error(`Question ${i + 1} has an unknown type`);
    return {
      id: cleanId(q.id), type: q.type,
      label: str(q.label, `Question ${i + 1}`, LIMITS.short),
      placeholder: str(q.placeholder ?? '', `Question ${i + 1} placeholder`, LIMITS.short, true),
      required: bool(q.required, `Question ${i + 1} required`),
    };
  });
  const options = Array.isArray(input.options) ? input.options : [];
  if (!options.length) throw new Error('Add at least one option to the main menu');
  if (options.length > LIMITS.options) throw new Error(`The main menu can have at most ${LIMITS.options} options`);

  const flow: ChatFlow = {
    enabled: bool(input.enabled, 'enabled'),
    botName: str(input.botName, 'Bot name', 60),
    botSubtitle: str(input.botSubtitle ?? '', 'Subtitle', 80, true),
    welcome: str(input.welcome, 'Welcome message', LIMITS.text),
    askDetails: bool(input.askDetails, 'askDetails'),
    questions,
    defaultCountry: typeof input.defaultCountry === 'string' && /^[A-Z]{2}$/.test(input.defaultCountry) ? input.defaultCountry : 'IN',
    detailsPlaceholder: str(input.detailsPlaceholder ?? '', 'Placeholder while answering', LIMITS.short, true),
    menuPrompt: str(input.menuPrompt, 'Main menu message', LIMITS.text),
    options: options.map((o: any, i: number) => option(o, 1, `Main menu option ${i + 1}`)),
    askResolved: bool(input.askResolved, 'askResolved'),
    resolvedQuestion: str(input.resolvedQuestion, '"Did this solve" question', LIMITS.short),
    yesLabel: str(input.yesLabel, 'Yes button', 40),
    noLabel: str(input.noLabel, 'No button', 40),
    yesReply: str(input.yesReply, 'Reply to Yes', LIMITS.text),
    noReply: str(input.noReply, 'Reply to No', LIMITS.text),
    showBack: bool(input.showBack, 'showBack'),
    backLabel: str(input.backLabel, 'Back button', 40),
    showRestart: bool(input.showRestart, 'showRestart'),
    restartLabel: str(input.restartLabel, 'Restart button', 40),
    restartMessage: str(input.restartMessage, 'Restart message', LIMITS.text),
    restartPrompt: str(input.restartPrompt, 'Restart prompt', LIMITS.text),
    menuPlaceholder: str(input.menuPlaceholder ?? '', 'Placeholder in menus', LIMITS.short, true),
  };
  if (flow.askDetails && !flow.questions.length) throw new Error('Add at least one question, or turn off "Ask for details"');
  return flow;
}

// ── Running a flow ──────────────────────────────────────────────────────────

/** Find an option anywhere in the tree. */
export function findOption(options: ChatFlowOption[], optionId: string | null): ChatFlowOption | null {
  if (!optionId) return null;
  for (const o of options) {
    if (o.id === optionId) return o;
    const hit = o.kind === 'menu' && o.children ? findOption(o.children, optionId) : null;
    if (hit) return hit;
  }
  return null;
}

/** The options showing at a node (null = main menu); falls back to the main menu if the node was edited away. */
export function optionsAt(flow: ChatFlow, node: string | null): ChatFlowOption[] {
  const n = findOption(flow.options, node);
  return n?.kind === 'menu' && n.children?.length ? n.children : flow.options;
}

export const fillName = (text: string, name?: string) =>
  text.replace(/\{name\}/g, (name || '').trim().split(/\s+/)[0] || 'there');

/** E.164-ish: +<country><number>, 8–15 digits in total. */
export const validPhone = (v: string) => /^\+[1-9]\d{7,14}$/.test(v.replace(/[\s()-]/g, ''));
export const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
