// api/verify.js
//
// Verifies a FamApp payment by checking Gmail live via IMAP — no database.
// Given a UTR (UPI-funded transfer) or a FAM transaction ID (works for
// both UPI-funded and wallet-to-wallet transfers), it searches the inbox
// for the matching "You received ₹X in your FamX account" email and
// returns the payment details straight from that email.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const { EMAIL_USER, EMAIL_APP_PASSWORD } = process.env;

// Parses the plain-text body of a FamApp "you received" email.
// Handles both cases:
//  - UPI-funded transfer (has a UTR line)
//  - wallet-to-wallet transfer (no UTR line at all)
function parseFamAppEmail(text) {
  const amountMatch = text.match(/You have successfully received\s*\r?\n?\s*₹\s*([\d.]+)/i);
  const txnIdMatch = text.match(/Transaction ID\s*:\s*(\S+)/i);
  const utrMatch = text.match(/UTR\s*:\s*(\S+)/i);
  const fromMatch = text.match(/from\s+([A-Za-z0-9 ._-]+)\r?\n/i);

  if (!amountMatch || !txnIdMatch) return null;

  return {
    amount: parseFloat(amountMatch[1]),
    fam_txn_id: txnIdMatch[1].trim(),
    utr: utrMatch ? utrMatch[1].trim() : null, // null => wallet-to-wallet, no UTR
    sender: fromMatch ? fromMatch[1].trim() : null,
  };
}

async function findPayment(verify) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // server-side search: FamApp sender + the UTR/FAMID text somewhere in the message
      const uids = await client.search(
        { from: 'no-reply@famapp.in', body: verify },
        { uid: true }
      );

      if (!uids || uids.length === 0) return null;

      // check most recent matches first
      const sorted = [...uids].sort((a, b) => b - a);

      for (const uid of sorted) {
        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message) continue;

        const parsedMail = await simpleParser(message.source);
        const text = parsedMail.text || '';
        if (!/You have successfully received/i.test(text)) continue;

        const parsed = parseFamAppEmail(text);
        if (!parsed) continue;

        // confirm the match is exact (body search can be a loose substring match)
        if (parsed.fam_txn_id === verify || parsed.utr === verify) {
          return { ...parsed, verified_at: parsedMail.date || new Date() };
        }
      }

      return null;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { verify } = req.query;

    if (!verify) {
      return res.status(400).json({
        success: false,
        error: 'Missing verify parameter',
        message: 'Usage: ?verify={utr_or_famid}'
      });
    }

    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      return res.status(500).json({
        success: false,
        error: 'Server misconfigured',
        message: 'EMAIL_USER / EMAIL_APP_PASSWORD not set'
      });
    }

    const payment = await findPayment(verify.trim());

    if (!payment) {
      return res.status(404).json({
        success: false,
        verified: false,
        error: 'Payment not found',
        message: `No verified payment found for: ${verify}`
      });
    }

    return res.status(200).json({
      success: true,
      verified: true,
      data: {
        amount: payment.amount,
        currency: '₹',
        utr: payment.utr || 'wallet to wallet transfer',
        fam_txn_id: payment.fam_txn_id,
        verified_at: payment.verified_at,
        wallet_credited: true
      }
    });

  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).json({
      success: false,
      verified: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}
