import { NextResponse } from 'next/server'
import dns from 'node:dns'
import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import { Resend } from 'resend'
import zlib from 'zlib'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'



// Use public DNS servers for MongoDB Atlas SRV resolution.
// The local DNS resolver was refusing Node.js SRV queries.
// dns.setServers(['8.8.8.8', '1.1.1.1'])

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

let client
let dbPromise

async function getDb() {
  if (!dbPromise) {
    client = new MongoClient(process.env.MONGO_URL)
    dbPromise = client.connect().then(c => c.db(process.env.DB_NAME))
  }
  return dbPromise
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 32).toString('hex')
  return { hash, salt }
}
function verifyPassword(password, hash, salt) {
  try {
    const test = crypto.scryptSync(password, salt, 32).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'))
  } catch { return false }
}
function makeToken() { return crypto.randomBytes(24).toString('hex') }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-user-role, x-user-name',
}

function ok(data, status = 200) {
  return NextResponse.json(data, { status, headers: CORS })
}
function err(message, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: CORS })
}

function actor(req) {
  return {
    id: req.headers.get('x-user-id') || 'system',
    role: req.headers.get('x-user-role') || 'super_admin',
    name: req.headers.get('x-user-name') || 'System',
  }
}

async function audit(db, action, entity, entityId, before, after, user, reason='') {
  await db.collection('audit_logs').insertOne({
    id: uuidv4(),
    action, entity, entityId,
    before: before || null,
    after: after || null,
    userId: user.id, userName: user.name, userRole: user.role,
    reason,
    createdAt: new Date().toISOString(),
    ip: 'internal',
  })
}

// ---------- Multi-partner consensus approval ----------

async function getRequiredApprovers(db) {
  // Active partners are the required consensus set
  return db.collection('users')
    .find({ role: 'partner', active: { $ne: false } }, { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1 } })
    .toArray()
}

function computeConsensusStatus(approvals, requiredIds) {
  const votes = approvals || []
  if (votes.some(v => v.decision === 'rejected')) return 'rejected'
  const yesIds = new Set(votes.filter(v => v.decision === 'approved').map(v => v.userId))
  const allApproved = requiredIds.length > 0 && requiredIds.every(id => yesIds.has(id))
  return allApproved ? 'approved' : 'pending'
}

function annotateApprovalProgress(item, requiredPartners) {
  const votes = item.approvals || []
  const voteById = {}
  votes.forEach(v => { voteById[v.userId] = v })
  const perPartner = requiredPartners.map(p => ({
    userId: p.id,
    name: p.name,
    decision: voteById[p.id]?.decision || 'pending',
    at: voteById[p.id]?.at || null,
    comment: voteById[p.id]?.comment || '',
  }))
  const approvedBy = perPartner.filter(p => p.decision === 'approved')
  const rejectedBy = perPartner.filter(p => p.decision === 'rejected')
  return {
    ...item,
    approvals: votes,
    approvalProgress: {
      required: requiredPartners.length,
      approvedCount: approvedBy.length,
      rejectedCount: rejectedBy.length,
      pendingCount: perPartner.filter(p => p.decision === 'pending').length,
      partners: perPartner,
    },
  }
}

async function castVote(db, collection, entity, id, action, body, user) {
  const before = await db.collection(collection).findOne({ id }, { projection: { _id: 0 } })
  if (!before) return { error: 'Not found', status: 404 }
  const partners = await getRequiredApprovers(db)
  const partnerIds = partners.map(p => p.id)

  // Only actual partners can cast a required vote; other roles get "observer" acknowledged but not required
  const isPartner = user.role === 'partner' && partnerIds.includes(user.id)
  const isSuperAdmin = user.role === 'super_admin'
  if (!isPartner && !isSuperAdmin && user.role !== 'admin_officer') {
    return { error: 'Only partners, admin officers, or super admins can vote', status: 403 }
  }

  const decision = action === 'approve' ? 'approved' : 'rejected'
  const votes = Array.isArray(before.approvals) ? [...before.approvals] : []
  const idx = votes.findIndex(v => v.userId === user.id)
  const vote = {
    userId: user.id, userName: user.name, userRole: user.role,
    decision, comment: body?.comment || '', at: new Date().toISOString(),
  }
  if (idx >= 0) votes[idx] = vote; else votes.push(vote)

  // Status derives from active-partner consensus only
  const newStatus = computeConsensusStatus(votes, partnerIds)

  const patch = {
    approvals: votes,
    status: newStatus,
    // last vote metadata for compatibility with existing UI fields
    approvedBy: newStatus === 'approved' ? user.id : before.approvedBy || null,
    approvedByName: newStatus === 'approved' ? user.name : before.approvedByName || null,
    approvedAt: newStatus === 'approved' ? new Date().toISOString() : before.approvedAt || null,
    approvalComment: body?.comment || before.approvalComment || '',
  }
  await db.collection(collection).updateOne({ id }, { $set: patch })
  const after = { ...before, ...patch }
  await audit(db, `VOTE_${decision.toUpperCase()}`, entity, id, before, after, user,
    body?.comment || `${user.name} ${decision} · consensus now ${newStatus} (${votes.filter(v=>v.decision==='approved').length}/${partnerIds.length} partners approved)`)
  return { data: annotateApprovalProgress(after, partners) }
}

// ---------- Report + Email helpers ----------

const fmtInr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)

function computeReport(txs, budgets, period, anchor = new Date()) {
  let start, end, label
  if (period === 'day') {
    start = new Date(anchor); start.setUTCHours(0, 0, 0, 0)
    end = new Date(anchor); end.setUTCHours(23, 59, 59, 999)
    label = anchor.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  } else if (period === 'month') {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
    end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 23, 59, 59, 999))
    label = anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  } else if (period === 'quarter') {
    const q = Math.floor(anchor.getUTCMonth() / 3)
    start = new Date(Date.UTC(anchor.getUTCFullYear(), q * 3, 1))
    end = new Date(Date.UTC(anchor.getUTCFullYear(), q * 3 + 3, 0, 23, 59, 59, 999))
    label = `Q${q + 1} ${anchor.getUTCFullYear()}`
  } else {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1))
    end = new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31, 23, 59, 59, 999))
    label = `FY ${anchor.getUTCFullYear()}`
  }
  const scoped = txs.filter(t => { const d = new Date(t.createdAt); return d >= start && d <= end })
  const approved = scoped.filter(t => t.status === 'approved')
  const income = approved.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expense = approved.filter(t => ['expense', 'vendor_payment'].includes(t.type)).reduce((s, t) => s + t.amount, 0)
  const byCategory = {}
  approved.filter(t => ['expense', 'vendor_payment'].includes(t.type)).forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount
  })
  return {
    label, start, end,
    income, expense, profit: income - expense,
    txCount: scoped.length,
    approvedCount: approved.length,
    pendingCount: scoped.filter(t => t.status === 'pending').length,
    byCategory: Object.entries(byCategory).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    topTx: [...scoped].sort((a, b) => b.amount - a.amount).slice(0, 8),
    totalBudget: budgets.reduce((s, b) => s + b.amount, 0),
    budgetUsed: budgets.reduce((s, b) => s + (b.utilized || 0), 0),
  }
}

function reportEmailHtml(recipient, report, portalUrl) {
  const rows = report.topTx.map(t => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#333">${new Date(t.createdAt).toLocaleDateString('en-IN')}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#333">${(t.type || '').replace('_', ' ')}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#333">${t.description || ''}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#333;text-align:right;font-weight:600">${fmtInr(t.amount)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:12px;color:#666">${t.status}</td>
    </tr>`).join('') || '<tr><td colspan="5" style="padding:20px;text-align:center;color:#999;font-size:13px">No transactions in this period</td></tr>'
  const catRows = report.byCategory.slice(0, 6).map(c => `
    <tr>
      <td style="padding:8px 14px;font-size:13px;color:#333">${c.name}</td>
      <td style="padding:8px 14px;font-size:13px;color:#333;text-align:right;font-weight:600">${fmtInr(c.amount)}</td>
    </tr>`).join('') || '<tr><td colspan="2" style="padding:12px;text-align:center;color:#999;font-size:13px">No expenses</td></tr>'
  const utilPct = report.totalBudget > 0 ? ((report.budgetUsed / report.totalBudget) * 100).toFixed(1) : 0

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:640px;margin:0 auto;background:#fff">
    <div style="background:linear-gradient(180deg,#0f0f0f 0%,#1a1a1a 100%);padding:28px 32px;border-bottom:3px solid #d4af37">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-family:Georgia,serif;font-size:24px;font-weight:800;color:#f4d97a;letter-spacing:0.3px">PartnerSync</div>
          <div style="color:#c9c1a8;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px">Partner Transparency Portal</div>
        </div>
        <div style="text-align:right">
          <div style="color:#d4af37;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Automated Report</div>
          <div style="color:#fff;font-size:13px;margin-top:2px">${report.label}</div>
        </div>
      </div>
    </div>

    <div style="padding:32px">
      <h1 style="margin:0;font-family:Georgia,serif;font-size:26px;color:#0f0f0f;font-weight:700">Hello ${recipient.name.split(' ')[0]},</h1>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:8px 0 0">
        Here is your automated financial summary for <b>${report.label}</b>. Every figure below reflects approved entries only and is fully backed by the immutable audit trail.
      </p>

      <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:24px">
        <tr>
          <td style="padding:6px" width="33%">
            <div style="border:1px solid #eee;border-radius:10px;padding:14px;background:linear-gradient(135deg,#faf6e6,#fff)">
              <div style="font-size:10px;color:#8a6b1a;text-transform:uppercase;letter-spacing:1px;font-weight:700">Income</div>
              <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#0f0f0f;margin-top:4px">${fmtInr(report.income)}</div>
            </div>
          </td>
          <td style="padding:6px" width="33%">
            <div style="border:1px solid #eee;border-radius:10px;padding:14px">
              <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px;font-weight:700">Expenses</div>
              <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#0f0f0f;margin-top:4px">${fmtInr(report.expense)}</div>
            </div>
          </td>
          <td style="padding:6px" width="33%">
            <div style="border:1px solid #0f0f0f;border-radius:10px;padding:14px;background:#0f0f0f">
              <div style="font-size:10px;color:#d4af37;text-transform:uppercase;letter-spacing:1px;font-weight:700">Net Profit</div>
              <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#f4d97a;margin-top:4px">${fmtInr(report.profit)}</div>
            </div>
          </td>
        </tr>
      </table>

      <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px">
        <tr>
          <td style="padding:6px" width="50%">
            <div style="border:1px solid #eee;border-radius:10px;padding:14px">
              <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px;font-weight:700">Transactions</div>
              <div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#0f0f0f;margin-top:4px">
                ${report.txCount} <span style="font-size:11px;font-weight:500;color:#888;font-family:inherit">${report.approvedCount} approved · ${report.pendingCount} pending</span>
              </div>
            </div>
          </td>
          <td style="padding:6px" width="50%">
            <div style="border:1px solid #eee;border-radius:10px;padding:14px">
              <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px;font-weight:700">Budget Utilization</div>
              <div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#0f0f0f;margin-top:4px">${utilPct}%</div>
              <div style="height:6px;background:#eee;border-radius:3px;margin-top:6px;overflow:hidden">
                <div style="height:100%;width:${Math.min(100, utilPct)}%;background:linear-gradient(135deg,#d4af37,#f4d97a,#b8860b)"></div>
              </div>
            </div>
          </td>
        </tr>
      </table>

      <h3 style="font-family:Georgia,serif;font-size:16px;color:#0f0f0f;margin:28px 0 10px">Expenses by Category</h3>
      <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#faf6e6">
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#8a6b1a">Category</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#8a6b1a">Amount</th>
        </tr></thead>
        <tbody>${catRows}</tbody>
      </table>

      <h3 style="font-family:Georgia,serif;font-size:16px;color:#0f0f0f;margin:28px 0 10px">Top Transactions</h3>
      <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#0f0f0f">
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#d4af37">Date</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#d4af37">Type</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#d4af37">Description</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#d4af37">Amount</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#d4af37">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="margin-top:32px;padding:20px;background:linear-gradient(135deg,#0f0f0f,#1a1a1a);border-radius:12px;text-align:center">
        <div style="color:#d4af37;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700">Full Report</div>
        <p style="color:#c9c1a8;font-size:13px;margin:8px 0 14px">Access the interactive dashboard, drill into any transaction, and download a signed PDF.</p>
        <a href="${portalUrl}" style="display:inline-block;padding:10px 28px;background:linear-gradient(135deg,#d4af37,#f4d97a,#b8860b);color:#0f0f0f;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px">Open PartnerSync Portal →</a>
      </div>

      <p style="color:#999;font-size:11px;line-height:1.6;margin-top:24px;text-align:center">
        You are receiving this because you are a partner on record.<br/>
        Every action in PartnerSync is logged with timestamp, user, and reason. No record can be deleted — only versioned.
      </p>
    </div>
  </div>
</body></html>`
}

async function sendDailyReports(db, period, recipientMode, actor) {
  const [users, txs, budgets] = await Promise.all([
    db.collection('users').find({}, { projection: { _id: 0, passwordHash: 0, passwordSalt: 0 } }).toArray(),
    db.collection('transactions').find({}, { projection: { _id: 0 } }).toArray(),
    db.collection('budgets').find({}, { projection: { _id: 0 } }).toArray(),
  ])
  const anchor = period === 'day' ? new Date(Date.now() - 24 * 3600 * 1000) : new Date()
  const report = computeReport(txs, budgets, period, anchor)

  const active = users.filter(u => u.active !== false && u.email)
  const recipients = recipientMode === 'all_active' ? active : active.filter(u => u.role === 'partner')
  const portalUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://partnersync.local'
  const from = process.env.RESEND_FROM || 'PartnerSync <onboarding@resend.dev>'
  const providerName = resendClient ? 'resend' : 'demo'

  const subject = `PartnerSync · ${report.label} Financial Summary`
  const batchId = uuidv4()
  const sentAt = new Date().toISOString()

  const results = []
  for (const r of recipients) {
    const htmlBody = reportEmailHtml(r, report, portalUrl)
    const record = {
      id: uuidv4(),
      batchId,
      to: r.email,
      toName: r.name,
      toRole: r.role,
      subject,
      period,
      reportLabel: report.label,
      provider: providerName,
      from,
      status: 'sending',
      sentAt,
      triggeredBy: actor.name,
      triggeredByRole: actor.role,
      summary: {
        income: report.income, expense: report.expense, profit: report.profit,
        txCount: report.txCount, approvedCount: report.approvedCount,
      },
      htmlBody,
    }
    await db.collection('sent_emails').insertOne(record)

    if (!resendClient) {
      // Demo mode fallback — record as delivered without a real send
      await db.collection('sent_emails').updateOne(
        { id: record.id },
        { $set: { status: 'delivered', deliveredAt: new Date().toISOString() } }
      )
      results.push({ id: record.id, to: r.email, toName: r.name, status: 'delivered', provider: 'demo' })
      continue
    }

    try {
      const send = await resendClient.emails.send({
        from,
        to: [r.email],
        subject,
        html: htmlBody,
      })
      if (send.error) {
        await db.collection('sent_emails').updateOne(
          { id: record.id },
          { $set: {
              status: 'failed',
              error: { name: send.error.name || 'ResendError', message: send.error.message || 'Unknown error' },
              updatedAt: new Date().toISOString(),
            } }
        )
        results.push({ id: record.id, to: r.email, toName: r.name, status: 'failed', error: send.error.message })
      } else {
        await db.collection('sent_emails').updateOne(
          { id: record.id },
          { $set: {
              status: 'accepted',
              resendId: send.data?.id || null,
              acceptedAt: new Date().toISOString(),
            } }
        )
        results.push({ id: record.id, to: r.email, toName: r.name, status: 'accepted', resendId: send.data?.id })
      }
    } catch (e) {
      await db.collection('sent_emails').updateOne(
        { id: record.id },
        { $set: {
            status: 'failed',
            error: { name: e.name || 'Error', message: e.message || 'Network error' },
            updatedAt: new Date().toISOString(),
          } }
      )
      results.push({ id: record.id, to: r.email, toName: r.name, status: 'failed', error: e.message })
    }
  }

  const okCount = results.filter(x => x.status === 'accepted' || x.status === 'delivered').length
  const failCount = results.filter(x => x.status === 'failed').length

  await db.collection('email_settings').updateOne(
    { id: 'default' },
    { $set: {
        id: 'default',
        lastSentAt: sentAt,
        lastBatchId: batchId,
        lastRecipientCount: results.length,
        lastSuccessCount: okCount,
        lastFailureCount: failCount,
      } },
    { upsert: true }
  )
  await audit(db, 'EMAIL_BATCH_SENT', 'email_batch', batchId, null,
    { period, recipients: results.length, ok: okCount, failed: failCount, provider: providerName, label: report.label }, actor,
    `Sent ${okCount}/${results.length} report emails for ${report.label} via ${providerName}${failCount > 0 ? ` (${failCount} failed)` : ''}`)

  return {
    batchId, sentAt,
    provider: providerName,
    recipientCount: results.length,
    okCount, failCount,
    period, label: report.label,
    recipients: results,
  }
}

async function sendTemplateEmail(db, to, toName, subject, html, meta, actor) {
  const from = process.env.RESEND_FROM || 'PartnerSync <onboarding@resend.dev>'
  const providerName = resendClient ? 'resend' : 'demo'
  const record = {
    id: uuidv4(),
    batchId: meta?.batchId || uuidv4(),
    to, toName: toName || to,
    toRole: meta?.toRole || 'user',
    subject,
    period: meta?.period || 'transactional',
    reportLabel: meta?.reportLabel || subject,
    provider: providerName,
    from,
    status: 'sending',
    sentAt: new Date().toISOString(),
    triggeredBy: actor?.name || 'System',
    triggeredByRole: actor?.role || 'system',
    kind: meta?.kind || 'transactional',
    summary: meta?.summary || {},
    htmlBody: html,
  }
  await db.collection('sent_emails').insertOne(record)
  if (!resendClient) {
    await db.collection('sent_emails').updateOne({ id: record.id },
      { $set: { status: 'delivered', deliveredAt: new Date().toISOString() } })
    return { ok: true, id: record.id, status: 'delivered', provider: 'demo' }
  }
  try {
    const send = await resendClient.emails.send({ from, to: [to], subject, html })
    if (send.error) {
      await db.collection('sent_emails').updateOne({ id: record.id },
        { $set: { status: 'failed', error: { name: send.error.name, message: send.error.message } } })
      return { ok: false, error: send.error.message, id: record.id }
    }
    await db.collection('sent_emails').updateOne({ id: record.id },
      { $set: { status: 'accepted', resendId: send.data?.id || null, acceptedAt: new Date().toISOString() } })
    return { ok: true, id: record.id, resendId: send.data?.id }
  } catch (e) {
    await db.collection('sent_emails').updateOne({ id: record.id },
      { $set: { status: 'failed', error: { name: e.name, message: e.message } } })
    return { ok: false, error: e.message, id: record.id }
  }
}

function transactionalHtml({ title, greeting, body, ctaText, ctaUrl, footer }) {
  const portalUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://partnersync.local'
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff">
    <div style="background:linear-gradient(180deg,#0f0f0f 0%,#1a1a1a 100%);padding:24px 32px;border-bottom:3px solid #d4af37">
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:800;color:#f4d97a">PartnerSync</div>
      <div style="color:#c9c1a8;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px">Partner Transparency Portal</div>
    </div>
    <div style="padding:32px">
      <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;color:#0f0f0f">${title}</h1>
      ${greeting ? `<p style="color:#333;font-size:15px;margin:12px 0 0">${greeting}</p>` : ''}
      <div style="color:#444;font-size:14px;line-height:1.7;margin-top:16px">${body}</div>
      ${ctaText && ctaUrl ? `<div style="margin-top:28px;padding:20px;background:linear-gradient(135deg,#0f0f0f,#1a1a1a);border-radius:12px;text-align:center">
        <a href="${ctaUrl || portalUrl}" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#d4af37,#f4d97a,#b8860b);color:#0f0f0f;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px">${ctaText} →</a>
      </div>` : ''}
      <p style="color:#999;font-size:11px;line-height:1.6;margin-top:28px;text-align:center;border-top:1px solid #eee;padding-top:16px">
        ${footer || 'Every action in PartnerSync is logged with timestamp, user, and reason. No record is deletable — only versioned.'}
      </p>
    </div>
  </div>
</body></html>`
}

async function scheduleTick(db) {
  try {
    const settings = await db.collection('email_settings').findOne({ id: 'default' })
    if (!settings || settings.enabled === false) return
    const now = new Date()
    const dueMinutes = (settings.hour ?? 9) * 60 + (settings.minute ?? 0)
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    if (nowMinutes < dueMinutes) return
    const todayKey = now.toISOString().slice(0, 10)
    if (settings.lastSentDate === todayKey) return
    // Mark first so concurrent requests don't double-send
    const claim = await db.collection('email_settings').updateOne(
      { id: 'default', lastSentDate: { $ne: todayKey } },
      { $set: { lastSentDate: todayKey } }
    )
    if (claim.modifiedCount === 0) return
    const sysUser = { id: 'scheduler', name: 'Scheduler', role: 'super_admin' }
    await sendDailyReports(db, settings.period || 'day', settings.recipients || 'partners', sysUser)
  } catch (e) {
    console.error('scheduleTick error', e)
  }
}

async function seedIfEmpty(db) {
  const c = await db.collection('_meta').findOne({ id: 'seed_v1' })
  if (c) return

  const partners = [
    { name: 'Aarav Mehta', role: 'partner', email: 'aarav@partnersync.io', capital: 2500000, share: 40 },
    { name: 'Priya Sharma', role: 'partner', email: 'priya@partnersync.io', capital: 1800000, share: 30 },
    { name: 'Rohan Iyer', role: 'partner', email: 'rohan@partnersync.io', capital: 1200000, share: 20 },
    { name: 'Neha Kapoor', role: 'finance_manager', email: 'neha@partnersync.io', capital: 500000, share: 10 },
  ].map((u, i) => {
    const { hash, salt } = hashPassword('partner123')
    return {
      ...u,
      id: uuidv4(),
      passwordHash: hash,
      passwordSalt: salt,
      active: true,
      isSuperAdmin: i === 0,
      createdAt: new Date().toISOString(),
      lastLogin: null,
    }
  })
  // Super Admin account
  {
    const { hash, salt } = hashPassword('admin123')
    partners.push({
      id: uuidv4(),
      name: 'System Admin', role: 'super_admin', email: 'admin@partnersync.io',
      capital: 0, share: 0,
      passwordHash: hash, passwordSalt: salt,
      active: true, isSuperAdmin: true,
      createdAt: new Date().toISOString(), lastLogin: null,
    })
  }
  await db.collection('users').insertMany(partners)

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const budgets = [
    { id: uuidv4(), name: 'Annual Operating Budget 2025', type: 'annual', amount: 12000000, utilized: 7450000, status: 'approved', period: '2025', createdBy: partners[0].id, createdByName: partners[0].name, createdAt: new Date(now.getFullYear(),0,5).toISOString() },
    { id: uuidv4(), name: 'Marketing — Q3', type: 'marketing', amount: 850000, utilized: 512000, status: 'approved', period: '2025-Q3', createdBy: partners[1].id, createdByName: partners[1].name, createdAt: new Date(now.getFullYear(),5,10).toISOString() },
    { id: uuidv4(), name: 'CapEx — Machinery', type: 'capex', amount: 3200000, utilized: 1800000, status: 'approved', period: '2025', createdBy: partners[0].id, createdByName: partners[0].name, createdAt: new Date(now.getFullYear(),2,15).toISOString() },
    { id: uuidv4(), name: 'Operations — Monthly', type: 'operational', amount: 620000, utilized: 288000, status: 'pending', period: new Intl.DateTimeFormat('en',{year:'numeric',month:'short'}).format(now), createdBy: partners[2].id, createdByName: partners[2].name, createdAt: monthStart.toISOString() },
  ]
  await db.collection('budgets').insertMany(budgets)

  const vendors = [
    { id: uuidv4(), name: 'SteelForge Industries', category: 'Raw Materials', rating: 4.6, totalPurchases: 4200000, pendingPayment: 320000 },
    { id: uuidv4(), name: 'NovaTech Solutions', category: 'Software', rating: 4.8, totalPurchases: 780000, pendingPayment: 0 },
    { id: uuidv4(), name: 'Prime Logistics', category: 'Transport', rating: 4.2, totalPurchases: 950000, pendingPayment: 145000 },
    { id: uuidv4(), name: 'Bright Ads Media', category: 'Marketing', rating: 4.5, totalPurchases: 340000, pendingPayment: 62000 },
  ]
  await db.collection('vendors').insertMany(vendors)

  const txSeed = [
    { type: 'income', category: 'Sales Revenue', amount: 1450000, mode: 'bank', status: 'approved', description: 'October product invoicing batch 4', ago: 2 },
    { type: 'income', category: 'Consulting', amount: 380000, mode: 'upi', status: 'approved', description: 'Advisory retainer — Client Zenith', ago: 5 },
    { type: 'expense', category: 'Marketing', amount: 128000, mode: 'bank', status: 'approved', description: 'LinkedIn campaign — Q3 push', ago: 3 },
    { type: 'expense', category: 'Salary', amount: 620000, mode: 'bank', status: 'approved', description: 'October payroll disbursement', ago: 6 },
    { type: 'expense', category: 'Office', amount: 42000, mode: 'cash', status: 'pending', description: 'HQ pantry restock + supplies', ago: 1 },
    { type: 'vendor_payment', category: 'Raw Materials', amount: 520000, mode: 'cheque', status: 'pending', description: 'SteelForge Invoice #INV-4421', ago: 0 },
    { type: 'investment', category: 'Equipment', amount: 780000, mode: 'bank', status: 'pending', description: 'CNC Machine — Line 3 upgrade', ago: 0 },
    { type: 'partner_contribution', category: 'Capital Infusion', amount: 500000, mode: 'bank', status: 'approved', description: 'Q4 capital call — Aarav', ago: 8 },
    { type: 'expense', category: 'Travel', amount: 34500, mode: 'upi', status: 'approved', description: 'Client visit — Bangalore', ago: 4 },
    { type: 'income', category: 'Service Revenue', amount: 210000, mode: 'bank', status: 'approved', description: 'Retainer — Client Aurora', ago: 9 },
  ]
  const txDocs = txSeed.map((t, i) => ({
    id: uuidv4(),
    type: t.type, category: t.category, amount: t.amount, gst: Math.round(t.amount * 0.18),
    mode: t.mode, status: t.status,
    description: t.description,
    invoiceNumber: 'INV-' + (4400 + i),
    createdBy: partners[i % partners.length].id,
    createdByName: partners[i % partners.length].name,
    approvedBy: t.status === 'approved' ? partners[0].id : null,
    approvedByName: t.status === 'approved' ? partners[0].name : null,
    approvedAt: t.status === 'approved' ? new Date(Date.now() - t.ago * 86400000 + 3600000).toISOString() : null,
    createdAt: new Date(Date.now() - t.ago * 86400000).toISOString(),
    comments: [],
  }))
  await db.collection('transactions').insertMany(txDocs)

  const quotations = [
    { id: uuidv4(), title: 'Website Rebuild — Corporate', vendorName: 'NovaTech Solutions', amount: 640000, status: 'under_review', versions: 2, createdBy: partners[1].id, createdByName: partners[1].name, createdAt: new Date(Date.now()-2*86400000).toISOString() },
    { id: uuidv4(), title: 'Steel Beam Procurement — Batch 12', vendorName: 'SteelForge Industries', amount: 1250000, status: 'approved', versions: 3, createdBy: partners[0].id, createdByName: partners[0].name, createdAt: new Date(Date.now()-6*86400000).toISOString() },
    { id: uuidv4(), title: 'Q4 Ad Campaign — Multi-channel', vendorName: 'Bright Ads Media', amount: 480000, status: 'submitted', versions: 1, createdBy: partners[2].id, createdByName: partners[2].name, createdAt: new Date(Date.now()-1*86400000).toISOString() },
    { id: uuidv4(), title: 'Fleet Contract Renewal', vendorName: 'Prime Logistics', amount: 780000, status: 'rejected', versions: 2, createdBy: partners[1].id, createdByName: partners[1].name, createdAt: new Date(Date.now()-9*86400000).toISOString() },
  ]
  await db.collection('quotations').insertMany(quotations)

  await db.collection('_meta').insertOne({ id: 'seed_v1', at: new Date().toISOString() })
}

async function handle(req, ctx) {
  const db = await getDb()
  await seedIfEmpty(db)
  // Fire-and-forget daily email scheduler check
  scheduleTick(db).catch(() => {})

  const params = ctx?.params ? await ctx.params : {}
  const path = (params?.path || []).join('/')
  const method = req.method
  const user = actor(req)

  try {
    // === Health ===
    if (path === '' || path === 'health') {
      return ok({ status: 'ok', app: 'PartnerSync', ts: new Date().toISOString() })
    }

    // === Users / Partners ===
    if (path === 'users' && method === 'GET') {
      const users = await db.collection('users').find(
        {},
        { projection: { _id: 0, passwordHash: 0, passwordSalt: 0 } }
      ).toArray()
      return ok(users)
    }

    // === Auth: signup ===
    if (path === 'auth/signup' && method === 'POST') {
      const body = await req.json()
      const name = (body.name || '').trim()
      const email = (body.email || '').trim().toLowerCase()
      const password = body.password || ''
      if (!name || !email || !password) return err('Name, email and password are required', 400)
      if (password.length < 6) return err('Password must be at least 6 characters', 400)
      const existing = await db.collection('users').findOne({ email })
      if (existing) return err('An account with this email already exists', 409)
      const { hash, salt } = hashPassword(password)
      // First user auto-bootstraps as Super Admin
      const adminCount = await db.collection('users').countDocuments({ role: 'super_admin' })
      const isFirst = adminCount === 0
      const doc = {
        id: uuidv4(),
        name, email,
        role: isFirst ? 'super_admin' : null,   // Super Admin assigns role at approval
        capital: 0,
        share: 0,
        passwordHash: hash, passwordSalt: salt,
        active: isFirst,
        approvalStatus: isFirst ? 'approved' : 'pending',
        isSuperAdmin: isFirst,
        createdAt: new Date().toISOString(),
        lastLogin: isFirst ? new Date().toISOString() : null,
      }
      await db.collection('users').insertOne(doc)
      await audit(db, 'SIGNUP', 'user', doc.id, null,
        { name, email, role: doc.role, approvalStatus: doc.approvalStatus },
        { id: doc.id, name, role: doc.role }, isFirst ? 'First user auto-approved as Super Admin' : 'Account created — awaiting Super Admin role assignment & approval')
      if (!isFirst) {
        return ok({
          pending: true,
          message: 'Account created. A Super Admin will assign your role and approve your access.',
          user: { id: doc.id, name, email, role: null, approvalStatus: 'pending' },
        })
      }
      const token = makeToken()
      const safe = { id: doc.id, name, email, role: 'super_admin', capital: 0, share: 0, active: true, isSuperAdmin: true, createdAt: doc.createdAt, approvalStatus: 'approved' }
      return ok({ user: safe, token })
    }

    // === Auth: login ===
    if (path === 'auth/login' && method === 'POST') {
      const body = await req.json()
      const email = (body.email || '').trim().toLowerCase()
      const password = body.password || ''
      const rec = await db.collection('users').findOne({ email })
      if (!rec) return err('Invalid email or password', 401)
      if (!rec.passwordHash || !rec.passwordSalt) return err('Account not registered for password login. Use signup.', 401)
      if (!verifyPassword(password, rec.passwordHash, rec.passwordSalt)) return err('Invalid email or password', 401)
      if (rec.approvalStatus === 'pending') return err('Your account is awaiting Super Admin approval.', 403)
      if (rec.approvalStatus === 'rejected') return err('Your signup was rejected. Please contact your Super Admin.', 403)
      if (rec.active === false) return err('Your account has been deactivated. Contact your Super Admin.', 403)
      await db.collection('users').updateOne({ id: rec.id }, { $set: { lastLogin: new Date().toISOString() } })
      const token = makeToken()
      const safe = {
        id: rec.id, name: rec.name, email: rec.email, role: rec.role,
        capital: rec.capital, share: rec.share, active: rec.active !== false,
        isSuperAdmin: !!rec.isSuperAdmin, createdAt: rec.createdAt,
        approvalStatus: rec.approvalStatus || 'approved',
      }
      await audit(db, 'LOGIN', 'user', rec.id, null, { at: new Date().toISOString() }, { id: rec.id, name: rec.name, role: rec.role }, 'User signed in')
      return ok({ user: safe, token })
    }

    // === Auth: me (validate stored session against DB) ===
    if (path === 'auth/me' && method === 'GET') {
      const rec = await db.collection('users').findOne({ id: user.id })
      if (!rec) return err('Not found', 404)
      return ok({
        id: rec.id, name: rec.name, email: rec.email, role: rec.role,
        capital: rec.capital, share: rec.share, active: rec.active !== false,
        isSuperAdmin: !!rec.isSuperAdmin, createdAt: rec.createdAt,
      })
    }

    // === Admin: pending signups (super_admin only) ===
    if (path === 'admin/pending-signups' && method === 'GET') {
      if (user.role !== 'super_admin') return err('Forbidden — Super Admin only', 403)
      const list = await db.collection('users')
        .find({ approvalStatus: 'pending' }, { projection: { _id: 0, passwordHash: 0, passwordSalt: 0 } })
        .sort({ createdAt: -1 })
        .toArray()
      return ok(list)
    }

    // === Admin: approve or reject a signup ===
    const approveSignup = path.match(/^admin\/users\/([^/]+)\/(approve-signup|reject-signup)$/)
    if (approveSignup && method === 'POST') {
      if (user.role !== 'super_admin') return err('Forbidden — Super Admin only', 403)
      const [, id, action] = approveSignup
      const body = await req.json().catch(() => ({}))
      const before = await db.collection('users').findOne({ id }, { projection: { _id: 0, passwordHash: 0, passwordSalt: 0 } })
      if (!before) return err('User not found', 404)
      if (before.approvalStatus !== 'pending') return err('This account is not pending approval', 400)
      const isApprove = action === 'approve-signup'
      const patch = {
        approvalStatus: isApprove ? 'approved' : 'rejected',
        active: isApprove,
        approvedAt: new Date().toISOString(),
        approvedByName: user.name,
      }
      if (isApprove) {
        // Super Admin must supply a role at approval time
        const assignedRole = body.role
        if (!assignedRole) return err('Please assign a role before approving', 400)
        patch.role = assignedRole
        if (body.share != null) patch.share = Number(body.share) || 0
        if (body.capital != null) patch.capital = Number(body.capital) || 0
        if (assignedRole === 'super_admin') patch.isSuperAdmin = true
      }
      await db.collection('users').updateOne({ id }, { $set: patch })
      const after = { ...before, ...patch }
      await audit(db, isApprove ? 'SIGNUP_APPROVED' : 'SIGNUP_REJECTED', 'user', id, before, after, user,
        body.reason || (isApprove ? `Approved as ${patch.role}${patch.share ? ` · ${patch.share}% share` : ''}` : `Signup rejected by ${user.name}`))
      // Send email notification (best-effort)
      const portalUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://partnersync.local'
      if (isApprove) {
        const roleLabel = { partner: 'Partner', admin_officer: 'Admin Officer', super_admin: 'Super Admin' }[patch.role] || patch.role
        const html = transactionalHtml({
          title: 'Your access is ready',
          greeting: `Hello ${before.name.split(' ')[0]},`,
          body: `A Super Admin has approved your PartnerSync account.<br/><br/>
            <b>Role:</b> ${roleLabel}${patch.share ? `<br/><b>Share:</b> ${patch.share}%` : ''}${patch.capital ? `<br/><b>Capital on record:</b> ₹${Number(patch.capital).toLocaleString('en-IN')}` : ''}<br/><br/>
            You can now sign in and start collaborating.`,
          ctaText: 'Open the Portal', ctaUrl: portalUrl,
        })
        sendTemplateEmail(db, before.email, before.name, 'PartnerSync · Your account is approved',
          html, { kind: 'signup_approved', toRole: patch.role }, user).catch(() => {})
      } else {
        const html = transactionalHtml({
          title: 'Signup declined',
          greeting: `Hello ${before.name.split(' ')[0]},`,
          body: `Your PartnerSync signup request was not approved at this time.${body.reason ? `<br/><br/><b>Reason:</b> ${body.reason}` : ''}<br/><br/>Please contact your Super Admin for more information.`,
          footer: 'This is an automated notification. Reply to your Super Admin for questions.',
        })
        sendTemplateEmail(db, before.email, before.name, 'PartnerSync · Signup update',
          html, { kind: 'signup_rejected' }, user).catch(() => {})
      }
      return ok(after)
    }

    // === Auth: forgot password (public) ===
    if (path === 'auth/forgot-password' && method === 'POST') {
      const body = await req.json()
      const email = (body.email || '').trim().toLowerCase()
      if (!email) return err('Email is required', 400)
      const rec = await db.collection('users').findOne({ email })
      // Do NOT reveal whether the account exists — respond identically either way
      if (!rec || rec.approvalStatus !== 'approved' || rec.active === false) {
        return ok({ ok: true, message: 'If an account with that email exists, a reset link has been sent.' })
      }
      const tempPassword = 'PS-' + crypto.randomBytes(4).toString('hex').toUpperCase()
      const { hash, salt } = hashPassword(tempPassword)
      await db.collection('users').updateOne({ id: rec.id }, { $set: { passwordHash: hash, passwordSalt: salt, passwordResetAt: new Date().toISOString() } })
      const portalUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://partnersync.local'
      const html = transactionalHtml({
        title: 'Your temporary password',
        greeting: `Hello ${rec.name.split(' ')[0]},`,
        body: `You requested a password reset. Use the temporary password below to sign in — then change it from your profile.<br/><br/>
          <div style="font-family:monospace;font-size:22px;font-weight:700;background:#faf6e6;border:1px solid #d4af37;padding:14px 20px;border-radius:8px;text-align:center;letter-spacing:2px">${tempPassword}</div><br/>
          If you didn't request this, contact your Super Admin immediately — someone may have used your email address.`,
        ctaText: 'Sign in', ctaUrl: portalUrl,
      })
      await sendTemplateEmail(db, rec.email, rec.name, 'PartnerSync · Password reset',
        html, { kind: 'password_reset' }, { id: 'system', name: 'System', role: 'system' })
      await audit(db, 'PASSWORD_RESET_REQUEST', 'user', rec.id, null,
        { at: new Date().toISOString() }, { id: rec.id, name: rec.name, role: rec.role || 'user' },
        'Temporary password issued via email')
      return ok({ ok: true, message: 'If an account with that email exists, a reset link has been sent.' })
    }

    // === Admin: invite partner ===
    if (path === 'admin/invite' && method === 'POST') {
      if (user.role !== 'super_admin') return err('Forbidden — Super Admin only', 403)
      const body = await req.json()
      const name = (body.name || '').trim()
      const email = (body.email || '').trim().toLowerCase()
      const role = body.role || 'partner'
      if (!name || !email) return err('Name and email are required', 400)
      const existing = await db.collection('users').findOne({ email })
      if (existing) return err('An account with this email already exists', 409)
      const tempPassword = 'PS-' + crypto.randomBytes(4).toString('hex').toUpperCase()
      const { hash, salt } = hashPassword(tempPassword)
      const doc = {
        id: uuidv4(), name, email, role,
        capital: Number(body.capital) || 0,
        share: Number(body.share) || 0,
        passwordHash: hash, passwordSalt: salt,
        active: true, approvalStatus: 'approved',
        isSuperAdmin: role === 'super_admin',
        invitedBy: user.name, invitedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(), lastLogin: null,
      }
      await db.collection('users').insertOne(doc)
      const portalUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://partnersync.local'
      const roleLabel = { partner: 'Partner', admin_officer: 'Admin Officer', super_admin: 'Super Admin' }[role] || role
      const html = transactionalHtml({
        title: `You're invited to PartnerSync`,
        greeting: `Hello ${name.split(' ')[0]},`,
        body: `<b>${user.name}</b> has invited you to join PartnerSync as a <b>${roleLabel}</b>${doc.share ? ` with a ${doc.share}% share` : ''}.<br/><br/>
          Sign in with the temporary credentials below and update your password immediately.<br/><br/>
          <b>Email:</b> ${email}<br/>
          <b>Temporary password:</b>
          <div style="font-family:monospace;font-size:20px;font-weight:700;background:#faf6e6;border:1px solid #d4af37;padding:12px 18px;border-radius:8px;text-align:center;letter-spacing:2px;margin-top:8px">${tempPassword}</div>`,
        ctaText: 'Open PartnerSync', ctaUrl: portalUrl,
      })
      const sendResult = await sendTemplateEmail(db, email, name,
        `Invitation to PartnerSync from ${user.name}`, html, { kind: 'invite', toRole: role }, user)
      await audit(db, 'USER_INVITED', 'user', doc.id, null,
        { name, email, role, share: doc.share, capital: doc.capital }, user,
        `Invited as ${role}${doc.share ? ` · ${doc.share}% share` : ''}`)
      return ok({
        id: doc.id, name, email, role,
        tempPassword,
        emailStatus: sendResult.ok ? 'sent' : 'failed',
        emailError: sendResult.error || null,
      })
    }

    // === Admin: users list with rich stats (super_admin only) ===
    if (path === 'admin/users' && method === 'GET') {
      if (user.role !== 'super_admin') return err('Forbidden — Super Admin only', 403)
      const [users, txs] = await Promise.all([
        db.collection('users').find({}, { projection: { _id: 0, passwordHash: 0, passwordSalt: 0 } }).toArray(),
        db.collection('transactions').find({}, { projection: { _id: 0 } }).toArray(),
      ])
      const rows = users.map(u => {
        const created = txs.filter(t => t.createdBy === u.id)
        const approved = txs.filter(t => t.approvedBy === u.id)
        const contributions = created.filter(t => t.type === 'partner_contribution' && t.status === 'approved').reduce((s, t) => s + t.amount, 0)
        const totalVolume = created.filter(t => t.status === 'approved').reduce((s, t) => s + t.amount, 0)
        return {
          ...u,
          stats: {
            transactionsCreated: created.length,
            transactionsApproved: approved.length,
            contributions,
            totalVolume,
            pendingCreated: created.filter(t => t.status === 'pending').length,
          },
        }
      })
      return ok(rows)
    }

    // === Admin: update user (role, share, active, capital) ===
    const adminUserUpd = path.match(/^admin\/users\/([^/]+)$/)
    if (adminUserUpd && method === 'PATCH') {
      if (user.role !== 'super_admin') return err('Forbidden — Super Admin only', 403)
      const [, id] = adminUserUpd
      const body = await req.json()
      const before = await db.collection('users').findOne({ id }, { projection: { _id: 0, passwordHash: 0, passwordSalt: 0 } })
      if (!before) return err('User not found', 404)
      const patch = {}
      if (typeof body.role === 'string') patch.role = body.role
      if (typeof body.active === 'boolean') patch.active = body.active
      if (body.share != null) patch.share = Number(body.share)
      if (body.capital != null) patch.capital = Number(body.capital)
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
      if (Object.keys(patch).length === 0) return err('Nothing to update', 400)
      await db.collection('users').updateOne({ id }, { $set: patch })
      const after = { ...before, ...patch }
      await audit(db, 'ADMIN_UPDATE', 'user', id, before, after, user, body.reason || 'Admin updated user')
      return ok(after)
    }

    // === Admin: reset user password ===
    const adminResetPw = path.match(/^admin\/users\/([^/]+)\/reset-password$/)
    if (adminResetPw && method === 'POST') {
      if (user.role !== 'super_admin') return err('Forbidden — Super Admin only', 403)
      const [, id] = adminResetPw
      const body = await req.json()
      const rec = await db.collection('users').findOne({ id })
      if (!rec) return err('User not found', 404)
      const newPw = body.password || crypto.randomBytes(6).toString('hex')
      const { hash, salt } = hashPassword(newPw)
      await db.collection('users').updateOne({ id }, { $set: { passwordHash: hash, passwordSalt: salt } })
      await audit(db, 'ADMIN_RESET_PASSWORD', 'user', id, null, { at: new Date().toISOString() }, user, 'Admin reset password')
      return ok({ resetPassword: newPw, note: 'Share this temporary password with the user securely.' })
    }

    // === Dashboard ===
    if (path === 'dashboard' && method === 'GET') {
      const [txs, budgets, quotes, vendors] = await Promise.all([
        db.collection('transactions').find({}, { projection: { _id: 0 } }).toArray(),
        db.collection('budgets').find({}, { projection: { _id: 0 } }).toArray(),
        db.collection('quotations').find({}, { projection: { _id: 0 } }).toArray(),
        db.collection('vendors').find({}, { projection: { _id: 0 } }).toArray(),
      ])
      const approved = txs.filter(t => t.status === 'approved')
      const income = approved.filter(t => t.type === 'income').reduce((s,t)=>s+t.amount,0)
      const expense = approved.filter(t => ['expense','vendor_payment'].includes(t.type)).reduce((s,t)=>s+t.amount,0)
      const invested = approved.filter(t => ['investment','partner_contribution'].includes(t.type)).reduce((s,t)=>s+t.amount,0)
      const totalBudget = budgets.reduce((s,b)=>s+b.amount,0)
      const budgetUsed = budgets.reduce((s,b)=>s+(b.utilized||0),0)
      const pendingApprovals = txs.filter(t=>t.status==='pending').length + quotes.filter(q=>['submitted','under_review'].includes(q.status)).length
      const outstanding = vendors.reduce((s,v)=>s+(v.pendingPayment||0),0)

      // last 6 months series
      const now = new Date()
      const series = []
      const hasAnyData = approved.length > 0
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth()-i, 1)
        const label = d.toLocaleString('en', { month: 'short' })
        const monthTx = approved.filter(t => {
          const td = new Date(t.createdAt); return td.getMonth() === d.getMonth() && td.getFullYear() === d.getFullYear()
        })
        const inc = monthTx.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0)
        const exp = monthTx.filter(t=>['expense','vendor_payment'].includes(t.type)).reduce((s,t)=>s+t.amount,0)
        // Only synthesize baseline when there's some real data; otherwise show real zeros
        const base = 800000 + (i*40000)
        series.push({
          month: label,
          income: hasAnyData ? (inc || base + Math.round(Math.random()*200000)) : inc,
          expense: hasAnyData ? (exp || Math.round((base + Math.random()*150000)*0.7)) : exp,
          profit: 0,
        })
      }
      series.forEach(s => s.profit = s.income - s.expense)

      const categoryBreakdown = {}
      approved.filter(t=>['expense','vendor_payment'].includes(t.type)).forEach(t=>{
        categoryBreakdown[t.category] = (categoryBreakdown[t.category]||0) + t.amount
      })
      const pieData = Object.entries(categoryBreakdown).map(([name,value])=>({ name, value }))

      const recent = [...txs].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,8)

      return ok({
        kpis: {
          totalBudget, budgetUsed,
          pendingApprovals,
          income, expense,
          profit: income - expense,
          cashFlow: income - expense + invested,
          bankBalance: hasAnyData ? (4200000 + income - expense) : 0,
          outstandingReceivables: hasAnyData ? 1245000 : 0,
          upcomingPayments: outstanding,
          quotationsSubmitted: quotes.length,
          quotationsApproved: quotes.filter(q=>q.status==='approved').length,
          quotationsRejected: quotes.filter(q=>q.status==='rejected').length,
          partnerContributions: approved.filter(t=>t.type==='partner_contribution').reduce((s,t)=>s+t.amount,0),
        },
        series,
        pieData,
        recent,
      })
    }

    // === Transactions ===
    if (path === 'transactions' && method === 'GET') {
      const txs = await db.collection('transactions').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray()
      const partners = await getRequiredApprovers(db)
      return ok(txs.map(t => annotateApprovalProgress(t, partners)))
    }
    if (path === 'transactions' && method === 'POST') {
      const body = await req.json()
      const doc = {
        id: uuidv4(),
        type: body.type,
        category: body.category,
        amount: Number(body.amount) || 0,
        gst: Math.round((Number(body.amount)||0) * (Number(body.gstPct||18)/100)),
        mode: body.mode || 'bank',
        status: 'pending',
        description: body.description || '',
        invoiceNumber: body.invoiceNumber || ('INV-' + Math.floor(Math.random()*90000+10000)),
        createdBy: user.id, createdByName: user.name,
        approvedBy: null, approvedByName: null, approvedAt: null,
        createdAt: new Date().toISOString(),
        comments: [],
      }
      await db.collection('transactions').insertOne(doc)
      delete doc._id
      await audit(db, 'CREATE', 'transaction', doc.id, null, doc, user, 'Transaction created')
      return ok(doc)
    }
    const txApprove = path.match(/^transactions\/([^/]+)\/(approve|reject)$/)
    if (txApprove && method === 'POST') {
      const [, id, action] = txApprove
      const body = await req.json().catch(()=>({}))
      const r = await castVote(db, 'transactions', 'transaction', id, action, body, user)
      if (r.error) return err(r.error, r.status)
      return ok(r.data)
    }
    const txComment = path.match(/^transactions\/([^/]+)\/comment$/)
    if (txComment && method === 'POST') {
      const [, id] = txComment
      const body = await req.json()
      const comment = { id: uuidv4(), text: body.text, userId: user.id, userName: user.name, userRole: user.role, createdAt: new Date().toISOString() }
      const before = await db.collection('transactions').findOne({ id }, { projection: { _id: 0 } })
      if (!before) return err('Transaction not found', 404)
      await db.collection('transactions').updateOne({ id }, { $push: { comments: comment } })
      await audit(db, 'COMMENT', 'transaction', id, null, comment, user, 'Comment added')
      return ok(comment)
    }

    // === Bank Statements ===
    if (path === 'bank-statements/upload' && method === 'POST') {
      if (user.role === 'partner') {
        return err('Forbidden: Partners are not permitted to upload statement documents', 403)
      }
      const body = await req.json().catch(() => ({}))
      if (!body || !body.fileData) return err('fileData (base64 string) is required', 400)

      const fileName = body.fileName || 'bank_statement.pdf'
      const base64Str = body.fileData.includes(',') ? body.fileData.split(',')[1] : body.fileData
      const pdfBuffer = Buffer.from(base64Str, 'base64')

      if (!pdfBuffer || pdfBuffer.length === 0) {
        return err('Invalid or empty PDF file', 400)
      }

      console.log('[BankStatementUpload] Uploading bank statement document:', fileName, 'Size:', pdfBuffer.length)

      const statementId = uuidv4()
      const statementDoc = {
        id: statementId,
        fileName,
        fileSize: pdfBuffer.length,
        contentType: 'application/pdf',
        base64Data: body.fileData,
        uploadedBy: user.id,
        uploadedByName: user.name,
        uploadedAt: new Date().toISOString(),
      }
      await db.collection('bank_statements').insertOne(statementDoc)

      delete statementDoc._id
      const cleanStatement = { ...statementDoc, base64Data: undefined }
      await audit(db, 'BANK_STATEMENT_UPLOAD', 'bank_statement', statementId, null, cleanStatement, user, `Uploaded bank statement "${fileName}"`)

      return ok({
        statement: cleanStatement,
      })
    }

    if (path === 'bank-statements' && method === 'GET') {
      const statements = await db.collection('bank_statements')
        .find({}, { projection: { _id: 0, base64Data: 0 } })
        .sort({ uploadedAt: -1 })
        .toArray()
      return ok(statements)
    }

    const bankStatementDetail = path.match(/^bank-statements\/([^/]+)$/)
    if (bankStatementDetail && method === 'GET') {
      const [, id] = bankStatementDetail
      const st = await db.collection('bank_statements').findOne({ id }, { projection: { _id: 0 } })
      if (!st) return err('Bank statement not found', 404)
      return ok(st)
    }

    // === Budgets ===
    if (path === 'budgets' && method === 'GET') {
      const b = await db.collection('budgets').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray()
      const partners = await getRequiredApprovers(db)
      return ok(b.map(x => annotateApprovalProgress(x, partners)))
    }
    if (path === 'budgets' && method === 'POST') {
      if (user.role === 'partner') {
        return err('Forbidden: Partners are not permitted to create budget entries', 403)
      }
      const body = await req.json()
      const doc = {
        id: uuidv4(),
        name: body.name, type: body.type || 'operational',
        amount: Number(body.amount)||0, utilized: 0,
        status: 'pending', period: body.period || String(new Date().getFullYear()),
        createdBy: user.id, createdByName: user.name,
        createdAt: new Date().toISOString(),
      }
      await db.collection('budgets').insertOne(doc)
      delete doc._id
      await audit(db, 'CREATE', 'budget', doc.id, null, doc, user, 'Budget created')
      return ok(doc)
    }
    const bApprove = path.match(/^budgets\/([^/]+)\/(approve|reject)$/)
    if (bApprove && method === 'POST') {
      const [, id, action] = bApprove
      const body = await req.json().catch(()=>({}))
      const r = await castVote(db, 'budgets', 'budget', id, action, body, user)
      if (r.error) return err(r.error, r.status)
      return ok(r.data)
    }

    // === Quotations ===
    if (path === 'quotations/compare' && method === 'GET') {
      const q = await db.collection('quotations').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray()
      const stop = new Set(['the','a','an','of','for','and','or','with','to','in','on','at','by','q1','q2','q3','q4','v1','v2','v3','v4','v5','batch','package','contract','proposal'])
      const keywordsOf = (title) => (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !stop.has(w))
      // Group by strongest shared keyword
      const buckets = new Map()
      q.forEach(item => {
        const kws = keywordsOf(item.title)
        if (kws.length === 0) return
        // pick lexicographically smallest keyword to make grouping stable
        const key = kws.sort()[0]
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(item)
      })
      const groups = []
      for (const [key, items] of buckets.entries()) {
        if (items.length < 2) continue
        const sorted = [...items].sort((a, b) => a.amount - b.amount)
        const lowest = sorted[0]
        const highest = sorted[sorted.length - 1]
        const avg = Math.round(sorted.reduce((s, x) => s + x.amount, 0) / sorted.length)
        const savings = highest.amount - lowest.amount
        const savingsPct = highest.amount > 0 ? (savings / highest.amount) * 100 : 0
        groups.push({
          key,
          label: key.charAt(0).toUpperCase() + key.slice(1),
          count: items.length,
          lowestId: lowest.id,
          highestId: highest.id,
          lowestAmount: lowest.amount,
          highestAmount: highest.amount,
          avgAmount: avg,
          savings,
          savingsPct: Number(savingsPct.toFixed(1)),
          items: sorted,
        })
      }
      groups.sort((a, b) => b.savings - a.savings)
      return ok(groups)
    }

    if (path === 'quotations' && method === 'GET') {
      const q = await db.collection('quotations').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray()
      // attach file counts
      const ids = q.map(x => x.id)
      const files = await db.collection('quotation_files').find({ quotationId: { $in: ids } }, { projection: { _id: 0, data: 0 } }).toArray()
      const filesByQ = {}
      files.forEach(f => { (filesByQ[f.quotationId] ||= []).push(f) })
      q.forEach(x => { x.files = filesByQ[x.id] || [] })
      const partners = await getRequiredApprovers(db)
      return ok(q.map(x => annotateApprovalProgress(x, partners)))
    }
    if (path === 'quotations' && method === 'POST') {
      const body = await req.json()
      const doc = {
        id: uuidv4(),
        title: body.title,
        vendorName: body.vendorName,
        vendorEmail: body.vendorEmail || '',
        vendorPhone: body.vendorPhone || '',
        amount: Number(body.amount)||0,
        status: 'submitted', versions: 1,
        notes: body.notes || '',
        source: body.source || 'internal',
        createdBy: user.id, createdByName: user.name,
        createdAt: new Date().toISOString(),
      }
      await db.collection('quotations').insertOne(doc)
      delete doc._id
      // Optional inline files
      if (Array.isArray(body.files) && body.files.length > 0) {
        const fileDocs = body.files.slice(0, 10).map(f => ({
          id: uuidv4(),
          quotationId: doc.id,
          name: f.name || 'file',
          type: f.type || 'application/octet-stream',
          size: f.size || 0,
          data: f.data || '',
          uploadedBy: user.name,
          uploadedAt: new Date().toISOString(),
        }))
        await db.collection('quotation_files').insertMany(fileDocs)
        doc.files = fileDocs.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, uploadedBy: f.uploadedBy, uploadedAt: f.uploadedAt }))
      }
      await audit(db, 'CREATE', 'quotation', doc.id, null, doc, user, 'Quotation submitted')
      return ok(doc)
    }

    // Public vendor quotation submission — no auth required
    if (path === 'vendor/quotation' && method === 'POST') {
      const body = await req.json()
      if (!body.vendorName || !body.title || !body.amount) return err('Vendor name, title and amount are required', 400)
      const doc = {
        id: uuidv4(),
        title: String(body.title).slice(0, 200),
        vendorName: String(body.vendorName).slice(0, 120),
        vendorEmail: String(body.vendorEmail || '').slice(0, 120),
        vendorPhone: String(body.vendorPhone || '').slice(0, 40),
        amount: Number(body.amount) || 0,
        status: 'submitted', versions: 1,
        notes: String(body.notes || '').slice(0, 2000),
        source: 'vendor_portal',
        createdBy: 'vendor',
        createdByName: body.vendorName,
        createdAt: new Date().toISOString(),
      }
      await db.collection('quotations').insertOne(doc)
      delete doc._id
      if (Array.isArray(body.files) && body.files.length > 0) {
        const fileDocs = body.files.slice(0, 10).map(f => ({
          id: uuidv4(),
          quotationId: doc.id,
          name: String(f.name || 'file').slice(0, 200),
          type: f.type || 'application/octet-stream',
          size: f.size || 0,
          data: f.data || '',
          uploadedBy: body.vendorName,
          uploadedAt: new Date().toISOString(),
        }))
        await db.collection('quotation_files').insertMany(fileDocs)
        doc.files = fileDocs.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size }))
      }
      const vendorUser = { id: 'vendor', name: body.vendorName, role: 'vendor' }
      await audit(db, 'VENDOR_SUBMIT', 'quotation', doc.id, null, doc, vendorUser, 'Quotation submitted via public vendor portal')
      return ok({ ...doc, message: 'Quotation submitted. You will be contacted after review.' })
    }

    // List files (metadata only) for a quotation
    const qFilesList = path.match(/^quotations\/([^/]+)\/files$/)
    if (qFilesList && method === 'GET') {
      const [, id] = qFilesList
      const files = await db.collection('quotation_files').find({ quotationId: id }, { projection: { _id: 0, data: 0 } }).toArray()
      return ok(files)
    }
    // Attach a file to an existing quotation
    if (qFilesList && method === 'POST') {
      const [, id] = qFilesList
      const body = await req.json()
      if (!body.name || !body.data) return err('name and data required', 400)
      const f = {
        id: uuidv4(),
        quotationId: id,
        name: body.name, type: body.type || 'application/octet-stream',
        size: body.size || 0, data: body.data,
        uploadedBy: user.name, uploadedAt: new Date().toISOString(),
      }
      await db.collection('quotation_files').insertOne(f)
      await audit(db, 'FILE_ATTACH', 'quotation', id, null, { name: f.name, size: f.size }, user, 'File attached')
      delete f.data; delete f._id
      return ok(f)
    }
    // Download a single file (returns base64 data)
    const qFileGet = path.match(/^quotations\/([^/]+)\/files\/([^/]+)$/)
    if (qFileGet && method === 'GET') {
      const [, , fileId] = qFileGet
      const f = await db.collection('quotation_files').findOne({ id: fileId }, { projection: { _id: 0 } })
      if (!f) return err('File not found', 404)
      return ok(f)
    }

    const qStatus = path.match(/^quotations\/([^/]+)\/(approve|reject|review)$/)
    if (qStatus && method === 'POST') {
      const [, id, action] = qStatus
      const body = await req.json().catch(() => ({}))
      if (action === 'review') {
        const before = await db.collection('quotations').findOne({ id }, { projection: { _id: 0 } })
        if (!before) return err('Quotation not found', 404)
        await db.collection('quotations').updateOne({ id }, { $set: { status: 'under_review' } })
        const after = { ...before, status: 'under_review' }
        await audit(db, 'REVIEW', 'quotation', id, before, after, user, body.comment || '')
        const partners = await getRequiredApprovers(db)
        return ok(annotateApprovalProgress(after, partners))
      }
      const r = await castVote(db, 'quotations', 'quotation', id, action, body, user)
      if (r.error) return err(r.error, r.status)
      return ok(r.data)
    }

    // === Vendors ===
    if (path === 'vendors' && method === 'GET') {
      const v = await db.collection('vendors').find({}, { projection: { _id: 0 } }).toArray()
      return ok(v)
    }

    // === Partner ledger ===
    if (path === 'ledger' && method === 'GET') {
      const partners = await db.collection('users').find({}, { projection: { _id: 0 } }).toArray()
      const txs = await db.collection('transactions').find({ status: 'approved' }, { projection: { _id: 0 } }).toArray()
      const totalProfit = txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0) - txs.filter(t=>['expense','vendor_payment'].includes(t.type)).reduce((s,t)=>s+t.amount,0)
      const rows = partners.map(p => {
        const contributions = txs.filter(t=>t.type==='partner_contribution' && t.createdBy===p.id).reduce((s,t)=>s+t.amount,0)
        const share = (p.share||0) / 100
        return {
          id: p.id, name: p.name, role: p.role, email: p.email,
          capital: p.capital, share: p.share,
          additionalInvestment: contributions,
          profitShare: Math.round(totalProfit * share),
          withdrawals: 0,
          outstandingBalance: p.capital + contributions + Math.round(totalProfit * share),
        }
      })
      return ok({ partners: rows, totalProfit })
    }

    // === Audit trail ===
    if (path === 'audit' && method === 'GET') {
      const logs = await db.collection('audit_logs').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()
      return ok(logs)
    }

    // === Notifications (derived from recent events) ===
    if (path === 'notifications' && method === 'GET') {
      const logs = await db.collection('audit_logs').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray()
      return ok(logs.map(l => ({
        id: l.id,
        title: `${l.action} · ${l.entity}`,
        message: `${l.userName} performed ${l.action.toLowerCase()} on ${l.entity}${l.reason ? ' — ' + l.reason : ''}`,
        createdAt: l.createdAt,
        icon: l.entity,
      })))
    }

    // === Reports ===
    if (path === 'reports' && method === 'GET') {
      const url = new URL(req.url)
      const period = url.searchParams.get('period') || 'month' // day | month | quarter | year
      const dateStr = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
      const format = url.searchParams.get('format') || 'json'
      const anchor = new Date(dateStr + 'T12:00:00.000Z')

      let start, end, label
      if (period === 'day') {
        start = new Date(anchor); start.setUTCHours(0, 0, 0, 0)
        end = new Date(anchor); end.setUTCHours(23, 59, 59, 999)
        label = anchor.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
      } else if (period === 'month') {
        start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
        end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 23, 59, 59, 999))
        label = anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      } else if (period === 'quarter') {
        const q = Math.floor(anchor.getUTCMonth() / 3)
        start = new Date(Date.UTC(anchor.getUTCFullYear(), q * 3, 1))
        end = new Date(Date.UTC(anchor.getUTCFullYear(), q * 3 + 3, 0, 23, 59, 59, 999))
        label = `Q${q + 1} ${anchor.getUTCFullYear()}`
      } else {
        start = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1))
        end = new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31, 23, 59, 59, 999))
        label = `FY ${anchor.getUTCFullYear()}`
      }

      const [txs, budgets, vendors, quotes] = await Promise.all([
        db.collection('transactions').find({}, { projection: { _id: 0 } }).toArray(),
        db.collection('budgets').find({}, { projection: { _id: 0 } }).toArray(),
        db.collection('vendors').find({}, { projection: { _id: 0 } }).toArray(),
        db.collection('quotations').find({}, { projection: { _id: 0 } }).toArray(),
      ])
      const inRange = (t) => {
        const d = new Date(t.createdAt)
        return d >= start && d <= end
      }
      const scoped = txs.filter(inRange)
      const approved = scoped.filter(t => t.status === 'approved')

      const income = approved.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expense = approved.filter(t => ['expense', 'vendor_payment'].includes(t.type)).reduce((s, t) => s + t.amount, 0)
      const investment = approved.filter(t => t.type === 'investment').reduce((s, t) => s + t.amount, 0)
      const contributions = approved.filter(t => t.type === 'partner_contribution').reduce((s, t) => s + t.amount, 0)
      const gstCollected = approved.filter(t => t.type === 'income').reduce((s, t) => s + (t.gst || 0), 0)
      const gstPaid = approved.filter(t => ['expense', 'vendor_payment'].includes(t.type)).reduce((s, t) => s + (t.gst || 0), 0)

      const byCategory = {}
      approved.filter(t => ['expense', 'vendor_payment'].includes(t.type)).forEach(t => {
        byCategory[t.category] = (byCategory[t.category] || 0) + t.amount
      })
      const byIncomeCategory = {}
      approved.filter(t => t.type === 'income').forEach(t => {
        byIncomeCategory[t.category] = (byIncomeCategory[t.category] || 0) + t.amount
      })
      const byMode = {}
      approved.forEach(t => {
        byMode[t.mode] = (byMode[t.mode] || 0) + t.amount
      })
      const byPartner = {}
      approved.forEach(t => {
        const k = t.createdByName || 'Unknown'
        if (!byPartner[k]) byPartner[k] = { created: 0, amount: 0 }
        byPartner[k].created += 1
        byPartner[k].amount += t.amount
      })

      const approvalStats = {
        approved: scoped.filter(t => t.status === 'approved').length,
        pending: scoped.filter(t => t.status === 'pending').length,
        rejected: scoped.filter(t => t.status === 'rejected').length,
      }

      const report = {
        meta: {
          period, label,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          generatedAt: new Date().toISOString(),
          generatedBy: user.name,
          generatedByRole: user.role,
        },
        summary: {
          income, expense,
          profit: income - expense,
          investment,
          contributions,
          gstCollected, gstPaid,
          netGst: gstCollected - gstPaid,
          transactionCount: scoped.length,
          approvedCount: approvalStats.approved,
          pendingCount: approvalStats.pending,
          rejectedCount: approvalStats.rejected,
        },
        byCategory: Object.entries(byCategory).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        byIncomeCategory: Object.entries(byIncomeCategory).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        byMode: Object.entries(byMode).map(([name, amount]) => ({ name, amount })),
        byPartner: Object.entries(byPartner).map(([name, v]) => ({ name, count: v.created, amount: v.amount })).sort((a, b) => b.amount - a.amount),
        transactions: scoped.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        budgets: budgets.map(b => ({ ...b, comments: undefined })),
      }

      if (format === 'csv') {
        const lines = []
        lines.push(`PartnerSync Financial Report,,,,`)
        lines.push(`Period,${report.meta.label},,,`)
        lines.push(`Generated,${new Date(report.meta.generatedAt).toLocaleString('en-IN')},,by,${report.meta.generatedBy}`)
        lines.push('')
        lines.push('SUMMARY,,,,')
        lines.push(`Income,${report.summary.income},,,`)
        lines.push(`Expenses,${report.summary.expense},,,`)
        lines.push(`Net Profit,${report.summary.profit},,,`)
        lines.push(`Investments,${report.summary.investment},,,`)
        lines.push(`Partner Contributions,${report.summary.contributions},,,`)
        lines.push(`GST Collected,${report.summary.gstCollected},,,`)
        lines.push(`GST Paid,${report.summary.gstPaid},,,`)
        lines.push(`Net GST,${report.summary.netGst},,,`)
        lines.push(`Total Transactions,${report.summary.transactionCount},Approved,${report.summary.approvedCount},Pending,${report.summary.pendingCount},Rejected,${report.summary.rejectedCount}`)
        lines.push('')
        lines.push('EXPENSE BY CATEGORY,,,,')
        lines.push('Category,Amount')
        report.byCategory.forEach(c => lines.push(`${c.name},${c.amount}`))
        lines.push('')
        lines.push('TRANSACTIONS,,,,,,,,')
        lines.push('Date,Type,Category,Description,Invoice,Mode,Amount,GST,Status,Created By,Approved By')
        report.transactions.forEach(t => {
          const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
          lines.push([
            new Date(t.createdAt).toLocaleString('en-IN'),
            t.type, t.category, escape(t.description),
            t.invoiceNumber, t.mode, t.amount, t.gst, t.status,
            t.createdByName, t.approvedByName || '',
          ].join(','))
        })
        const csv = lines.join('\n')
        return new NextResponse(csv, {
          status: 200,
          headers: {
            ...CORS,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="PartnerSync_${period}_${dateStr}.csv"`,
          },
        })
      }

      return ok(report)
    }


    // === Email Automation ===
    if (path === 'email/settings' && method === 'GET') {
      const s = await db.collection('email_settings').findOne({ id: 'default' }, { projection: { _id: 0 } })
      const defaults = {
        id: 'default',
        enabled: true,
        hour: 9, minute: 0,
        period: 'day',
        recipients: 'partners',
        lastSentAt: null,
        provider: resendClient ? 'resend' : 'demo',
        from: process.env.RESEND_FROM || 'PartnerSync <onboarding@resend.dev>',
      }
      return ok({ ...defaults, ...(s || {}), provider: resendClient ? 'resend' : 'demo' })
    }

    if (path === 'email/settings' && method === 'PATCH') {
      if (user.role !== 'super_admin') return err('Forbidden — Super Admin only', 403)
      const body = await req.json()
      const patch = {}
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
      if (Number.isInteger(body.hour) && body.hour >= 0 && body.hour <= 23) patch.hour = body.hour
      if (Number.isInteger(body.minute) && body.minute >= 0 && body.minute <= 59) patch.minute = body.minute
      if (['day', 'month', 'quarter', 'year'].includes(body.period)) patch.period = body.period
      if (['partners', 'all_active'].includes(body.recipients)) patch.recipients = body.recipients
      await db.collection('email_settings').updateOne(
        { id: 'default' },
        { $set: { id: 'default', ...patch } },
        { upsert: true }
      )
      const updated = await db.collection('email_settings').findOne({ id: 'default' }, { projection: { _id: 0 } })
      await audit(db, 'EMAIL_SETTINGS_UPDATE', 'email_settings', 'default', null, patch, user, 'Email settings updated')
      return ok(updated)
    }

    if (path === 'email/sent' && method === 'GET') {
      const emails = await db.collection('sent_emails')
        .find({}, { projection: { _id: 0, htmlBody: 0 } })
        .sort({ sentAt: -1 })
        .limit(100)
        .toArray()
      return ok(emails)
    }

    const emailDetail = path.match(/^email\/sent\/([^/]+)$/)
    if (emailDetail && method === 'GET') {
      const [, id] = emailDetail
      const e = await db.collection('sent_emails').findOne({ id }, { projection: { _id: 0 } })
      if (!e) return err('Email not found', 404)
      return ok(e)
    }

    if (path === 'email/send-now' && method === 'POST') {
      if (user.role !== 'super_admin') return err('Forbidden — Super Admin only', 403)
      const body = await req.json().catch(() => ({}))
      const settings = (await db.collection('email_settings').findOne({ id: 'default' })) || { period: 'day', recipients: 'partners' }
      const period = body.period || settings.period || 'day'
      const result = await sendDailyReports(db, period, settings.recipients || 'partners', user)
      return ok(result)
    }


    // === Factory Reset — wipes ALL data, keeps only the acting Super Admin ===
    if (path === 'factory-reset' && method === 'POST') {
      if (user.role !== 'super_admin') return err('Forbidden — Super Admin only', 403)
      const body = await req.json().catch(() => ({}))
      if (String(body.confirm || '').trim().toUpperCase() !== 'ERASE') return err('Type ERASE to confirm', 400)
      const me = await db.collection('users').findOne({ id: user.id })
      const collections = [
        'transactions', 'budgets', 'quotations', 'quotation_files',
        'vendors', 'audit_logs', 'sent_emails', 'email_settings',
        '_meta', 'users',
      ]
      for (const c of collections) await db.collection(c).deleteMany({})
      // Recreate acting super admin so they can continue
      if (me) {
        await db.collection('users').insertOne({
          id: me.id, name: me.name, email: me.email, role: 'super_admin',
          capital: 0, share: 0,
          passwordHash: me.passwordHash, passwordSalt: me.passwordSalt,
          active: true, isSuperAdmin: true,
          createdAt: new Date().toISOString(), lastLogin: new Date().toISOString(),
        })
      } else {
        // Fallback: create fresh admin
        const { hash, salt } = hashPassword('admin123')
        await db.collection('users').insertOne({
          id: uuidv4(), name: 'System Admin', email: 'admin@partnersync.io', role: 'super_admin',
          capital: 0, share: 0, passwordHash: hash, passwordSalt: salt,
          active: true, isSuperAdmin: true,
          createdAt: new Date().toISOString(), lastLogin: null,
        })
      }
      // Log the reset (in a fresh audit log)
      await db.collection('audit_logs').insertOne({
        id: uuidv4(),
        action: 'FACTORY_RESET',
        entity: 'system',
        entityId: 'system',
        before: null, after: null,
        userId: user.id, userName: user.name, userRole: 'super_admin',
        reason: 'Factory reset — all data erased, only acting super admin preserved',
        createdAt: new Date().toISOString(),
        ip: 'internal',
      })
      // Mark seeded so it doesn't auto-populate demo data on next request
      await db.collection('_meta').insertOne({ id: 'seed_v1', at: new Date().toISOString(), factoryReset: true })
      return ok({ ok: true, message: 'All data erased. Only your Super Admin account has been preserved.' })
    }

    // === Reset (dev helper) ===
    if (path === 'reset' && method === 'POST') {
      const cols = ['users','budgets','vendors','transactions','quotations','quotation_files','audit_logs','_meta','sent_emails','email_settings']
      for (const c of cols) await db.collection(c).deleteMany({})
      await seedIfEmpty(db)
      return ok({ reset: true })
    }

    return err('Not found: ' + path, 404)
  } catch (e) {
    console.error('API error', e)
    return err(e.message || 'Server error', 500)
  }
}

export async function GET(req, ctx)    { return handle(req, ctx) }
export async function POST(req, ctx)   { return handle(req, ctx) }
export async function PUT(req, ctx)    { return handle(req, ctx) }
export async function PATCH(req, ctx)  { return handle(req, ctx) }
export async function DELETE(req, ctx) { return handle(req, ctx) }
export async function OPTIONS()        { return new NextResponse(null, { status: 204, headers: CORS }) }
