import React, { useState } from 'react';
import { ConversationRating } from '../../../../../shared/src/types';
import { MessengerStringKey } from '../../../../../shared/src/messengerStrings';
import { useMessengerText } from './messengerText';

const FACES: { score: 1 | 2 | 3 | 4 | 5; emoji: string; label: MessengerStringKey }[] = [
  { score: 1, emoji: '😞', label: 'rateTerrible' },
  { score: 2, emoji: '🙁', label: 'rateBad' },
  { score: 3, emoji: '😐', label: 'rateOk' },
  { score: 4, emoji: '🙂', label: 'rateGreat' },
  { score: 5, emoji: '🤩', label: 'rateAmazing' },
];

/**
 * CSAT card in the Messenger after a conversation is resolved: pick a face (1–5), optionally add
 * a comment, send. Once rated it shows a thank-you with the chosen face.
 */
export const CsatCard: React.FC<{
  question: string;
  rating?: ConversationRating;
  active: boolean;                 // only the latest request can be answered
  themeColor: string;
  onSubmit: (score: number, comment: string) => Promise<string | null>; // returns an error message, or null
}> = ({ question, rating, active, themeColor, onSubmit }) => {
  const { t } = useMessengerText();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rating) {
    const face = FACES.find(f => f.score === rating.score);
    return (
      <div className="self-center w-full max-w-[300px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-center">
        <p className="text-2xl">{face?.emoji}</p>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 mt-1">{t('rateThanks')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">You rated this conversation “{face ? t(face.label) : ''}”.</p>
      </div>
    );
  }
  if (!active) return null;

  const send = async () => {
    if (!score) return;
    setBusy(true); setError(null);
    const err = await onSubmit(score, comment.trim());
    if (err) setError(err);
    setBusy(false);
  };

  return (
    <div className="self-center w-full max-w-[320px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 flex flex-col gap-3 shadow-sm">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 text-center">{question}</p>
      <div className="flex justify-between gap-1" role="radiogroup" aria-label="Rating">
        {FACES.map(f => (
          <button
            key={f.score}
            role="radio"
            aria-checked={score === f.score}
            aria-label={t(f.label)}
            title={t(f.label)}
            onClick={() => setScore(f.score)}
            disabled={busy}
            className={`w-11 h-11 rounded-full text-2xl flex items-center justify-center transition-all ${score === f.score ? 'scale-110 ring-2' : score ? 'opacity-40 hover:opacity-80' : 'hover:scale-110'}`}
            style={score === f.score ? { ['--tw-ring-color' as any]: themeColor } : undefined}
          >
            {f.emoji}
          </button>
        ))}
      </div>
      {score && (
        <>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder={t('rateMore')}
            className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button onClick={send} disabled={busy} className="h-9 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: themeColor }}>
            {busy ? t('sending') : t('sendFeedback')}
          </button>
        </>
      )}
    </div>
  );
};

export default CsatCard;
