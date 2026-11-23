import crypto from 'crypto';
import { ChatFlow, ChatFlowOption, ChatFlowQuestion, ChatFlowSettings, Workspace } from '../../../shared/src/types';

// ── Starting content (from the Chai Shots support flow); everything is editable in Settings › Chat flow ──

const id = () => crypto.randomBytes(5).toString('hex');
const answer = (label: string, text: string): ChatFlowOption => ({ id: id(), label, kind: 'answer', answer: text });
const menu = (label: string, prompt: string, children: ChatFlowOption[]): ChatFlowOption => ({ id: id(), label, kind: 'menu', prompt, children });
const agent = (label: string, text = ''): ChatFlowOption => ({ id: id(), label, kind: 'agent', answer: text });
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
        answer('Video Buffering / Loading Slowly', 'Buffering is annoying — let\'s fix it! 📶\n\n✅ **Quick Checks:**\n1. Check your internet speed (at least 3 Mbps for SD, 5 Mbps for HD)\n2. Move closer to your WiFi router, or switch to mobile data\n3. Pause other downloads/streams on the same network\n\n✅ **In the app:**\n1. Lower the video quality from the player ⚙️ settings\n2. Close and reopen the app\n3. Update to the latest version\n\n✅ **Still buffering?**\nRestart your router (unplug for 30 seconds → plug back in).' + CONTACT),
        answer('Video Not Playing / Black Screen', 'Let\'s get your video playing! ▶️\n\n✅ **Try these steps:**\n1. Check if other titles play — if not, it\'s the app/network, not the video\n2. Force close the app and open it again\n3. Update the app (App Store / Play Store / TV app store)\n4. Android: Settings → Apps → Chai Shots → **Clear cache**\n5. iPhone: delete and reinstall the app\n\n✅ **Black screen with sound?**\n- Turn off screen mirroring / screen recording\n- Disconnect external displays or HDMI adapters' + CONTACT),
        answer('Poor Video Quality', 'Want a sharper picture? 🎬\n\n✅ **Improve quality:**\n1. Tap ⚙️ in the player → choose **HD / High**\n2. Turn off **Data Saver** in Settings → Playback\n3. Use a faster connection (HD needs 5 Mbps+)\n\n✅ **Note:**\nQuality adjusts automatically when your internet slows down and goes back up when it improves.' + CONTACT),
        answer('Audio or Subtitle Issues', 'Let\'s sort out the sound and subtitles! 🔊\n\n✅ **Change audio language or subtitles:**\n1. While playing, tap the screen\n2. Tap the 💬 **Audio & Subtitles** icon\n3. Pick your language\n\n✅ **No sound / out of sync?**\n1. Check your device isn\'t on silent and volume is up\n2. Disconnect Bluetooth headphones and try again\n3. Restart the video from the beginning\n\nNot every title has every language — available options show in the menu.' + CONTACT),
        answer('Video Stuck or Freezing', 'Video freezing midway? Let\'s fix it! ⏸️\n\n✅ **Try this:**\n1. Pause for 10 seconds, then play again\n2. Lower the video quality from ⚙️\n3. Close other apps running in the background\n4. Restart your device\n5. Update the app to the latest version\n\nIf it always freezes at the same point in one title, tell us the title name and the time it stops.' + CONTACT),
        answer('Playback Error Code', 'Seeing an error code? Here\'s what to do! ⚠️\n\n✅ **Common fixes:**\n1. Log out and log back in\n2. Check your subscription is active (My Chai Shots → Subscription)\n3. Turn off any VPN or proxy\n4. Update the app\n5. Clear cache (Android) or reinstall (iPhone/TV)\n\n✅ **Still showing?**\nSend us:\n- The error code/message (screenshot)\n- Your device and app version\n- The title you were watching' + CONTACT),
        answer('Downloads & Offline Viewing', 'Watch offline anytime! 📥\n\n✅ **How to download:**\n1. Open a title and tap the ⬇️ **Download** icon\n2. Find it later in **My Chai Shots → Downloads**\n\n✅ **Download not working?**\n1. Check free storage on your phone\n2. Use WiFi or allow downloads on mobile data in Settings\n3. Downloads need an active subscription — renew to keep watching\n4. Downloads expire after a while; just download again\n\nDownloads are available on the mobile app only.' + CONTACT),
        answer('Cast to TV (Chromecast / AirPlay)', 'Let\'s get it on the big screen! 📺\n\n✅ **Chromecast:**\n1. Phone and Chromecast must be on the **same WiFi**\n2. Start a video and tap the 📡 **Cast** icon\n3. Pick your device\n\n✅ **AirPlay (iPhone):**\n1. Same WiFi as your Apple TV / AirPlay TV\n2. Tap the AirPlay icon in the player\n\n✅ **Cast icon missing?**\nRestart your phone and the Chromecast/TV, and update the app.' + CONTACT),
      ]),
      menu('Devices & TV', SUB_PROMPT('Devices & TV'), [
        answer('Log in on TV', 'Let\'s get you watching on TV! 📺\n\n✅ **Log in with a code:**\n1. Open Chai Shots on your TV and choose **"Log in"**\n2. A code / QR code appears on the TV\n3. On your phone, scan the QR code or go to **chaishots.com/activate**\n4. Enter the code and confirm\n\n✅ **Code not working?**\n- Codes expire in a few minutes — get a new one on the TV\n- Make sure you\'re logged in on your phone with the same account' + CONTACT),
        answer('Supported Devices', 'Chai Shots works on lots of devices! 📱💻📺\n\n✅ **Mobile:** Android phones & tablets, iPhone & iPad\n✅ **Web:** Chrome, Safari, Edge, Firefox on computers\n✅ **TV:** Android TV, Google TV, Fire TV Stick, Apple TV, Samsung & LG Smart TVs\n✅ **Casting:** Chromecast, AirPlay\n\nKeep the app updated for the best experience.' + CONTACT),
        answer('Device Limit Reached', 'Seeing "device limit reached"? 🔢\n\n✅ **Free up a slot:**\n1. Go to **My Chai Shots → Account Settings → Devices**\n2. Remove a device you don\'t use\n3. Log in on your new device\n\n✅ **Or sign out everywhere:**\nUse **"Logout from all devices"**, then log in again where you need it.\n\nThe number of devices depends on your plan — upgrade for more screens.' + CONTACT),
        answer('Remove a Device', '✅ **Remove a device from your account:**\n1. Go to **My Chai Shots → Account Settings → Devices**\n2. Find the device in the list\n3. Tap **Remove** and confirm\n\nThat device will be logged out right away.' + CONTACT),
        answer('Smart TV App Not Working', 'TV app acting up? Let\'s fix it! 🛠️\n\n✅ **Try these in order:**\n1. Update the Chai Shots TV app (IMPORTANT!)\n2. Update your TV software\n3. Unplug the TV for 30 seconds → plug back in\n4. Uninstall and reinstall the Chai Shots app\n5. Check your internet connection on the TV\n\n✅ **Still not working?**\nSend us your TV brand, model number and a photo of any error.' + CONTACT),
        answer('Watching on Multiple Devices', '✅ **Watch on more than one screen:**\n- Your plan decides how many screens can play at the same time\n- Check it in **My Chai Shots → Subscription**\n- If you see "Too many screens", stop playback on another device or upgrade your plan' + CONTACT),
      ]),
      menu('App & Technical Issues', SUB_PROMPT('App & Technical Issues'), [
        answer('App Crashing or Closing', 'App keeps closing? Let\'s fix it! 🔧\n\n✅ **Try these steps:**\n1. Update the app to the latest version\n2. Restart your phone\n3. Free up storage (keep at least 1 GB free)\n4. Android: Settings → Apps → Chai Shots → **Clear cache**\n5. Still crashing: Uninstall → Restart phone → Reinstall\n\n✅ **Tell us:**\nYour phone model, OS version and what you were doing when it crashed.' + CONTACT),
        answer('App Not Opening / Stuck on Loading', 'Stuck on the loading screen? ⏳\n\n✅ **Try this:**\n1. Check your internet — switch between WiFi and mobile data\n2. Turn off VPN\n3. Force close the app and reopen\n4. Update the app\n5. Clear cache (Android) or reinstall (iPhone)' + CONTACT),
        answer('Update the App', '✅ **Get the latest version:**\n- **Android:** Play Store → search **Chai Shots** → **Update**\n- **iPhone/iPad:** App Store → your profile icon → scroll to Chai Shots → **Update**\n- **TV:** your TV\'s app store → Chai Shots → Update\n\nTip: turn on auto-updates so you always have the latest fixes.' + CONTACT),
        answer('Clear Cache & Storage', '✅ **Clear the app cache:**\n- **Android:** Settings → Apps → Chai Shots → Storage → **Clear cache**\n- **iPhone:** delete the app and reinstall it (iOS has no cache button)\n- **TV:** Settings → Apps → Chai Shots → Clear cache\n\nClearing cache won\'t delete your account or watch history.' + CONTACT),
        answer('Not Getting Notifications', 'Missing new episode alerts? 🔔\n\n✅ **Turn notifications on:**\n1. Phone Settings → Notifications → Chai Shots → **Allow**\n2. In the app: My Chai Shots → Settings → **Notifications** → on\n3. Turn off Battery Saver / Do Not Disturb for the app' + CONTACT),
        answer('Error Message on Screen', 'Seeing an error? We\'ll help! ⚠️\n\n✅ **First try:**\n1. Close and reopen the app\n2. Check your internet connection\n3. Update the app\n4. Log out and log in again\n\n✅ **Still there?**\nTake a screenshot of the error and send it to us with your device model.' + CONTACT),
      ]),
      menu('Content & Search', SUB_PROMPT('Content & Search'), [
        answer('Can\'t Find a Show or Movie', 'Looking for something specific? 🔍\n\n✅ **Search tips:**\n1. Tap **Search** and type the title, actor or director\n2. Try a shorter name or check the spelling\n3. Browse by language or genre from the home screen\n\n✅ **Still missing?**\n- Some titles are only available in certain countries\n- Titles can leave when their licence ends\n- New releases may arrive on a scheduled date' + CONTACT),
        answer('Content Not Available in My Region', 'Seeing "not available in your region"? 🌍\n\n✅ **Why it happens:**\n- Some titles are licensed only for certain countries\n- A VPN or proxy can make it look like you\'re in another country — turn it off\n\n✅ **Travelling?**\nAvailable titles change with your location and come back when you return.' + CONTACT),
        answer('Change Language Preferences', '✅ **Pick the languages you watch:**\n1. Go to **My Chai Shots → Settings → Content Languages**\n2. Select your languages\n3. Your home screen will show more titles in those languages\n\nFor audio/subtitles while watching, tap the 💬 icon in the player.' + CONTACT),
        answer('Continue Watching Missing', 'Lost your Continue Watching row? 🕘\n\n✅ **Check:**\n1. You\'re on the same **profile** you watched on\n2. You\'re logged in with the same account\n3. Pull down to refresh the home screen\n\nTitles you finish, or haven\'t opened in a long time, drop off the row automatically.' + CONTACT),
        answer('My Watchlist', '✅ **Use your Watchlist:**\n1. Open a title and tap **➕ Watchlist**\n2. Find everything in **My Chai Shots → Watchlist**\n3. Tap ✓ again to remove a title\n\nEach profile has its own Watchlist.' + CONTACT),
        answer('Request a Show or Movie', 'Want something we don\'t have yet? 🎬\n\nWe\'d love to hear it! Tap **No — Still need help** below and tell us:\n- The title name\n- The language\n\nOur content team reviews every request.'),
        answer('Age Rating & Kids Content', '✅ **Keep viewing family-friendly:**\n1. Create a **Kids profile** (My Chai Shots → Add Profile → Kids)\n2. Kids profiles only show age-appropriate titles\n3. Add a **Profile Lock PIN** to other profiles so kids can\'t switch' + CONTACT),
      ]),
      agent('Other — talk to our team', 'Sure — connecting you to our support team. Please describe your issue and we’ll reply shortly.'),
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
    if (o.kind === 'agent') {
      return { id: oid, label, kind: 'agent', answer: str(o.answer ?? '', `"${label}" message`, LIMITS.text, true) };
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
