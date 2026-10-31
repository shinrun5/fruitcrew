import type { Ambassador } from '@prisma/client';
import { PUBLIC_URL } from './appUrl.js';
import { emailShell, escapeHtml, sendEmail } from './email.js';

// What a student ambassador hears about between visits to their portal: a
// store they referred getting set up (a reward for FruitCrew to check), and
// money on its way. (Their invite is sent from routes/ambassadorsAdmin.ts.)

type Who = Pick<Ambassador, 'name' | 'email'>;

const first = (a: Who) => escapeHtml(a.name.split(' ')[0] || a.name);
const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const moneyPage = `${PUBLIC_URL}/ambassador/money`;

/** A store they referred has an owner, a worker and a posted week: its bounty now waits on an admin's check. */
export function sendStoreSetUp(a: Who, storeName: string, bountyCents: number) {
  const store = escapeHtml(storeName);
  return sendEmail({
    to: a.email,
    subject: `${storeName} is set up — your ${usd(bountyCents)} reward is being checked`,
    html: emailShell(
      'A store you referred is set up',
      `<p>Hi ${first(a)},</p><p><b>${store}</b> now has an owner account, a worker and a posted schedule. Your ${usd(bountyCents)} reward is waiting for FruitCrew to check the business, and you’ll see it move in your Money tab.</p>`,
      { label: 'See my money', url: moneyPage },
    ),
    text: `Hi ${a.name}, ${storeName} is set up. Your ${usd(bountyCents)} reward is waiting for FruitCrew to check the business: ${moneyPage}`,
  });
}

/** A payout was marked sent. */
export function sendPaid(a: Who, amountCents: number, method: string | null) {
  const how = method ? ` by ${escapeHtml(method)}` : '';
  return sendEmail({
    to: a.email,
    subject: `FruitCrew sent you ${usd(amountCents)}`,
    html: emailShell(
      `You’ve been paid ${usd(amountCents)}`,
      `<p>Hi ${first(a)},</p><p>FruitCrew sent you ${usd(amountCents)}${how}. What it covers is listed in your Money tab.</p>`,
      { label: 'See my money', url: moneyPage },
    ),
    text: `Hi ${a.name}, FruitCrew sent you ${usd(amountCents)}${method ? ` by ${method}` : ''}. Details: ${moneyPage}`,
  });
}
