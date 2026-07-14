# Payment Verification API - Vercel Deployment (No Database)

REST API that verifies FamApp payments by checking Gmail **live** via IMAP —
no database involved. Given a UTR or a FAM transaction ID, it searches the
inbox for the matching "You received ₹X in your FamX account" email and
returns the payment details straight from that email.

## 📋 Endpoint

```
GET https://your-vercel-domain.vercel.app/api/verify?verify={utr_or_famid}
```

## 🚀 Deployment Steps

### 1. Prerequisites
- Vercel Account (free at vercel.com)
- A Gmail account that receives the FamApp notification emails
- A Gmail **App Password** for that account (Google Account → Security →
  2-Step Verification → App Passwords). Your normal Gmail password will
  NOT work for IMAP.
- Git installed

### 2. Setup

```bash
npm install -g vercel
cd vercel_api
vercel --prod
```

Follow the prompts and set these environment variables when asked (or add
them later in Vercel → Project → Settings → Environment Variables):

```
EMAIL_USER = your-gmail@gmail.com
EMAIL_APP_PASSWORD = your-16-char-app-password
```

## 📝 API Examples

### Success — UPI-funded transfer (has a UTR)
```
GET https://yourapp.vercel.app/api/verify?verify=003388717695
```
```json
{
  "success": true,
  "verified": true,
  "data": {
    "amount": 1.0,
    "currency": "₹",
    "utr": "003388717695",
    "fam_txn_id": "FMPIB6162465064",
    "verified_at": "2026-07-14T18:06:00.000Z",
    "wallet_credited": true
  }
}
```

### Success — wallet-to-wallet transfer (no UTR)
```
GET https://yourapp.vercel.app/api/verify?verify=FMPIB6005386423
```
```json
{
  "success": true,
  "verified": true,
  "data": {
    "amount": 4.0,
    "currency": "₹",
    "utr": "wallet to wallet transfer",
    "fam_txn_id": "FMPIB6005386423",
    "verified_at": "2026-06-30T15:41:00.000Z",
    "wallet_credited": true
  }
}
```

### Error Response
```json
{
  "success": false,
  "verified": false,
  "error": "Payment not found",
  "message": "No verified payment found for: 999999999"
}
```

## 🔧 How to Use with Bot

```python
import aiohttp

async def verify_payment(utr_or_famid):
    url = "https://yourapp.vercel.app/api/verify"
    params = {"verify": utr_or_famid}

    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            data = await resp.json()
            if data["success"]:
                return data["data"]
            return None
```

## ⚠️ Important limitations (since there's no database)

- **No duplicate-use protection.** Because nothing is persisted, calling
  `/api/verify` twice with the same UTR/FAM ID will return `verified: true`
  both times. If your bot needs to make sure a payment is only "redeemed"
  once, your bot has to track which UTR/FAM IDs it has already accepted
  (e.g. in its own storage) — this API only confirms the email exists.
- **Speed depends on inbox size.** Every request opens a fresh IMAP
  connection and searches the mailbox. A very large/old inbox will be
  slower to search than a small one.
- **Single email account only.** All FamApp notification emails must land
  in the one Gmail inbox configured via `EMAIL_USER`.

## 🔍 Troubleshooting

### 404 Not Found
- Double check the UTR/FAM ID spelling
- Make sure the notification email actually exists in the `EMAIL_USER`
  inbox (not archived to a different label/account)

### Auth errors
- Confirm `EMAIL_APP_PASSWORD` is a Gmail **App Password**, not the
  regular account password
- Confirm 2-Step Verification is enabled on the Gmail account (required
  to generate App Passwords)

### CORS Issues
- API has CORS enabled for all origins
- Can be called from browser or bot

## 📈 Monitoring

View logs in Vercel Dashboard → Deployments → Runtime Logs

---

**Ready to deploy? Run: `vercel --prod`**
